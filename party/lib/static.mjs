import { createReadStream, statSync, realpathSync } from 'node:fs';
import { resolve, join, extname, sep } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

export function contentTypeFor(path) {
  return TYPES[extname(String(path)).toLowerCase()] || 'application/octet-stream';
}

// SECURITY BOUNDARY. Maps a request path to a file under `root`, or null.
// The hub listens on a LAN in a pub: assume hostile input. Refuses, rather than
// tries to sanitise: NUL bytes, backslashes, anything still percent-encoded
// after one decode (double encoding), "." / ".." / dotfile segments, paths that
// do not start with a single "/", paths that spell out this root's own
// filesystem path, anything that lands outside root, and symlinks that point outside root.
// A URL path is always interpreted relative to root, so an absolute-looking
// path such as /etc/passwd means root/etc/passwd (inside root, a 404), never
// the real file. Returns the lexical path (join(root, ...)), not the realpath.
export function safeJoin(root, urlPath) {
  if (typeof root !== 'string' || typeof urlPath !== 'string') return null;
  if (urlPath.includes('\0')) return null;
  const raw = urlPath.split(/[?#]/)[0];
  let decoded;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;
  // Still carries an escape after decoding once: double-encoded. Refuse.
  if (/%[0-9a-fA-F]{2}/.test(decoded)) return null;
  if (!decoded.startsWith('/') || decoded.startsWith('//')) return null;

  const rootAbs = resolve(root);
  // A caller (or attacker) handing us a real filesystem path such as /Users/me/x.
  if (decoded === rootAbs || decoded.startsWith(rootAbs + sep)) return null;

  const segments = decoded.split('/').slice(1);
  for (const seg of segments) {
    if (seg === '.' || seg === '..' || (seg.startsWith('.') && seg !== '')) return null;
  }

  const abs = resolve(join(rootAbs, ...segments.filter(Boolean)));
  if (abs !== rootAbs && !abs.startsWith(rootAbs + sep)) return null;

  // Symlink escape: if it exists, where it really lives must still be inside root.
  let real;
  try {
    real = realpathSync(abs);
  } catch {
    return abs; // does not exist: serveFile will 404
  }
  let realRoot;
  try {
    realRoot = realpathSync(rootAbs);
  } catch {
    return null;
  }
  if (real !== realRoot && !real.startsWith(realRoot + sep)) return null;
  return abs;
}

// RFC 9110 range handling. Per RFC 9110 section 14.2 a Range header that is
// syntactically invalid, uses another unit, or asks for several ranges MAY be
// ignored, and is: the answer is a plain 200 with the whole file. Do NOT "fix"
// that into a 416. 416 is only for a well-formed range that lies outside the file.
//   { start, end }  satisfiable single range
//   'unsatisfiable' syntactically valid but outside the file -> 416
//   null            absent, not bytes, malformed or multi-range -> ignore, send 200
function parseRange(header, size) {
  if (typeof header !== 'string') return null;
  const m = /^\s*bytes\s*=\s*(\d{0,15})\s*-\s*(\d{0,15})\s*$/i.exec(header);
  if (!m) return null;
  const [, rawStart, rawEnd] = m;
  if (rawStart === '' && rawEnd === '') return null;
  if (rawStart === '') {
    const n = Number(rawEnd);
    if (n === 0 || size === 0) return 'unsatisfiable';
    return { start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(rawStart);
  const end = rawEnd === '' ? size - 1 : Number(rawEnd);
  if (rawEnd !== '' && end < start) return null; // invalid spec: ignore the header
  if (start >= size) return 'unsatisfiable';
  return { start, end: Math.min(end, size - 1) };
}

function plain(res, code, text, extra = {}) {
  if (res.headersSent) { res.destroy(); return; }
  res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8', ...extra });
  res.end(text);
}

export function serveFile(req, res, absPath) {
  let st;
  try {
    st = statSync(absPath);
  } catch {
    plain(res, 404, 'not found');
    return;
  }
  if (!st.isFile()) { plain(res, 404, 'not found'); return; }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    plain(res, 405, 'method not allowed', { Allow: 'GET, HEAD' });
    return;
  }

  const { size } = st;
  const type = contentTypeFor(absPath);
  // DELIBERATE DEVIATION from the original brief's `max-age=86400`. Card
  // filenames are deterministic, so a rebuild reuses them: a browser that cached
  // a card at rehearsal would play yesterday's clip on the big screen. Everything
  // is served over a LAN from a laptop a few feet away, so caching buys nothing.
  // Media is revalidated every time (ETag / Last-Modified, 304 when unchanged).
  // Do not put max-age back.
  const media = type.startsWith('video/') || type.startsWith('image/');
  const cache = media ? 'no-cache' : 'no-store';
  const etag = `"${size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
  const lastModified = st.mtime.toUTCString();
  const validators = media ? { ETag: etag, 'Last-Modified': lastModified } : {};

  if (media) {
    const inm = req.headers['if-none-match'];
    const ims = Date.parse(req.headers['if-modified-since']);
    const unchanged = inm !== undefined
      ? inm.split(',').some((t) => t.trim() === etag || t.trim() === `W/${etag}` || t.trim() === '*')
      : Number.isFinite(ims) && Math.floor(st.mtimeMs / 1000) * 1000 <= ims;
    if (unchanged) {
      res.writeHead(304, { ETag: etag, 'Last-Modified': lastModified, 'Cache-Control': cache });
      res.end();
      return;
    }
  }

  // If-Range: only honour the range if the validator still matches the file.
  const ifRange = req.headers['if-range'];
  const rangeHeader = ifRange !== undefined && media && ifRange.trim() !== etag && ifRange.trim() !== lastModified
    ? undefined
    : req.headers.range;
  const range = parseRange(rangeHeader, size);

  if (range === 'unsatisfiable') {
    res.writeHead(416, { 'Content-Range': `bytes */${size}`, 'Accept-Ranges': 'bytes', 'Content-Length': 0 });
    res.end();
    return;
  }

  const partial = range !== null;
  const start = partial ? range.start : 0;
  const end = partial ? range.end : size - 1;
  const headers = {
    'Content-Type': type,
    'Content-Length': size === 0 ? 0 : end - start + 1,
    'Accept-Ranges': 'bytes',
    'Cache-Control': cache,
    ...validators,
  };
  if (partial) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  res.writeHead(partial ? 206 : 200, headers);

  if (req.method === 'HEAD' || size === 0) { res.end(); return; }

  let stream;
  try {
    stream = createReadStream(absPath, { start, end });
  } catch {
    res.destroy(); // headers are out; the connection is all that is left to drop
    return;
  }
  // A TV that goes to sleep or a browser that seeks drops the socket mid-file.
  res.on('close', () => stream.destroy());
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}
