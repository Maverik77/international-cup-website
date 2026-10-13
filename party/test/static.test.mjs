import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { connect } from 'node:net';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, existsSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { contentTypeFor, safeJoin, serveFile } from '../lib/static.mjs';

const base = mkdtempSync(join(tmpdir(), 'static-'));
const root = join(base, 'root');
const sibling = join(base, 'rootbc'); // shares root's string prefix but is outside it
const outside = join(base, 'outside');
mkdirSync(root); mkdirSync(sibling); mkdirSync(outside);

const SIZE = 10000;
const CLIP = randomBytes(SIZE);
writeFileSync(join(root, 'clip.mp4'), CLIP);
writeFileSync(join(root, 'page.html'), '<p>hi</p>');
writeFileSync(join(root, 'empty.mp4'), '');
writeFileSync(join(root, 'big.mp4'), randomBytes(6 * 1024 * 1024));
mkdirSync(join(root, 'sub'));
writeFileSync(join(root, 'sub', 'a.txt'), 'a');
writeFileSync(join(root, '.hidden'), 'dot');
writeFileSync(join(sibling, 'secret.txt'), 'SIBLING SECRET');
writeFileSync(join(outside, 'secret.txt'), 'OUTSIDE SECRET');

let symlinkOk = true;
try {
  symlinkSync(outside, join(root, 'escape-dir'));
  symlinkSync(join(outside, 'secret.txt'), join(root, 'escape-file.txt'));
} catch { symlinkOk = false; }

after(() => { rmSync(base, { recursive: true, force: true }); });

let server; let origin; let host; let port;
before(async () => {
  server = createServer((req, res) => {
    const abs = safeJoin(root, req.url);
    if (!abs) { res.writeHead(403).end(); return; }
    serveFile(req, res, abs);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
  host = '127.0.0.1';
  origin = `http://${host}:${port}`;
});
after(() => { server.closeAllConnections?.(); server.close(); });

// A raw request, so nothing normalises the path or headers on the way out.
function raw(lines, { wait = 150 } = {}) {
  return new Promise((resolveP) => {
    const sock = connect(port, host);
    let data = Buffer.alloc(0);
    sock.on('data', (c) => { data = Buffer.concat([data, c]); });
    sock.on('error', () => {});
    sock.on('connect', () => sock.write(`${lines.join('\r\n')}\r\n\r\n`));
    const done = () => { sock.destroy(); resolveP(data.toString('latin1')); };
    sock.on('close', done);
    setTimeout(done, wait);
  });
}
const rawGet = (path, extra = []) => raw([`GET ${path} HTTP/1.1`, `Host: ${host}`, 'Connection: close', ...extra]);
const statusOf = (text) => Number(/^HTTP\/1\.1 (\d+)/.exec(text)?.[1]);

async function get(path, range) {
  const res = await fetch(`${origin}${path}`, range ? { headers: { Range: range } } : {});
  return { res, body: Buffer.from(await res.arrayBuffer()) };
}

test('content types', () => {
  assert.equal(contentTypeFor('a.mp4'), 'video/mp4');
  assert.equal(contentTypeFor('a.html'), 'text/html; charset=utf-8');
  assert.equal(contentTypeFor('a.json'), 'application/json; charset=utf-8');
  assert.equal(contentTypeFor('a.js'), 'text/javascript; charset=utf-8');
  assert.equal(contentTypeFor('a.css'), 'text/css; charset=utf-8');
  assert.equal(contentTypeFor('a.png'), 'image/png');
  assert.equal(contentTypeFor('A.MP4'), 'video/mp4');
  assert.equal(contentTypeFor('a.wat'), 'application/octet-stream');
});

// ---------------------------------------------------------------------------
// safeJoin: a security boundary.
// ---------------------------------------------------------------------------

test('safeJoin accepts ordinary paths and strips the query string', () => {
  assert.equal(safeJoin(root, '/clip.mp4'), join(root, 'clip.mp4'));
  assert.equal(safeJoin(root, '/clip.mp4?v=2'), join(root, 'clip.mp4'));
  assert.equal(safeJoin(root, '/sub/a.txt'), join(root, 'sub', 'a.txt'));
  assert.equal(safeJoin(root, '/nope.mp4'), join(root, 'nope.mp4'), 'a missing file is the 404 path, not a refusal');
});

test('safeJoin refuses ../ traversal, plain and encoded', () => {
  for (const p of [
    '/../../etc/passwd',
    '/../outside/secret.txt',
    '/sub/../../outside/secret.txt',
    '/%2e%2e/%2e%2e/etc/passwd',
    '/%2E%2E/outside/secret.txt',
    '/..%2foutside/secret.txt',
    '/..%2Foutside/secret.txt',
    '/%2e%2e%2foutside%2fsecret.txt',
    '/sub/%2e%2e/%2e%2e/outside/secret.txt',
    '/..',
    '/sub/..',
    '/./clip.mp4',
    '/..\\outside\\secret.txt',
    '/%5c..%5coutside',
    '/..%5coutside',
  ]) assert.equal(safeJoin(root, p), null, `must refuse ${p}`);
});

test('safeJoin refuses double-encoded traversal', () => {
  for (const p of [
    '/%252e%252e/%252e%252e/outside/secret.txt',
    '/%252e%252e%252foutside',
    '/..%252foutside/secret.txt',
    '/%25%32%65%25%32%65/outside',
    '/%252E%252E%255Coutside',
  ]) assert.equal(safeJoin(root, p), null, `must refuse ${p}`);
});

test('safeJoin refuses absolute paths', () => {
  assert.equal(safeJoin(root, '//etc/passwd'), null);
  assert.equal(safeJoin(root, '///etc/passwd'), null);
  assert.equal(safeJoin(root, 'etc/passwd'), null, 'no leading slash');
  assert.equal(safeJoin(root, resolve(root, 'clip.mp4')), null, 'a real filesystem path is not a URL path');
  // A URL path is always relative to root: an absolute-looking one can only ever
  // name root/<that path> (a 404), never the real file it spells.
  for (const p of [join(outside, 'secret.txt'), '/etc/passwd']) {
    const got = safeJoin(root, p);
    assert.ok(got === null || (got.startsWith(root + '/') && got !== p), `${p} -> ${got}`);
  }
  assert.equal(safeJoin(root, 'C:\\Windows\\win.ini'), null);
  assert.equal(safeJoin(root, ''), null);
});

test('safeJoin refuses NUL bytes, raw and encoded', () => {
  assert.equal(safeJoin(root, '/clip.mp4\0.png'), null);
  assert.equal(safeJoin(root, '/clip.mp4%00.png'), null);
  assert.equal(safeJoin(root, '/%00'), null);
  assert.equal(safeJoin(root, '/clip.mp4?\0'), null);
});

test('safeJoin refuses a sibling that shares the root as a string prefix', () => {
  // root is .../root ; .../rootbc starts with the same characters but is outside.
  assert.ok(sibling.startsWith(root));
  assert.equal(safeJoin(root, '/../rootbc/secret.txt'), null);
  assert.equal(safeJoin(root, '/%2e%2e/rootbc/secret.txt'), null);
  const viaAbsolute = safeJoin(root, sibling + '/secret.txt');
  assert.ok(viaAbsolute === null || viaAbsolute.startsWith(root + '/'), 'never the sibling file itself');
  assert.notEqual(viaAbsolute, join(sibling, 'secret.txt'));
});

test('safeJoin refuses malformed escapes and non-strings', () => {
  assert.equal(safeJoin(root, '/%'), null);
  assert.equal(safeJoin(root, '/%zz'), null);
  assert.equal(safeJoin(root, '/%E0%A4%A'), null);
  assert.equal(safeJoin(root, undefined), null);
  assert.equal(safeJoin(root, null), null);
  assert.equal(safeJoin(root, 42), null);
  assert.equal(safeJoin(undefined, '/x'), null);
});

test('safeJoin refuses dotfiles', () => {
  assert.equal(safeJoin(root, '/.hidden'), null);
  assert.equal(safeJoin(root, '/sub/.git/config'), null);
});

test('safeJoin refuses a symlink that escapes the root', { skip: !symlinkOk && 'cannot create symlinks here' }, () => {
  assert.equal(safeJoin(root, '/escape-file.txt'), null);
  assert.equal(safeJoin(root, '/escape-dir/secret.txt'), null);
  assert.equal(safeJoin(root, '/escape-dir'), null);
});

test('safeJoin allows a symlink that stays inside the root', { skip: !symlinkOk && 'cannot create symlinks here' }, () => {
  symlinkSync(join(root, 'clip.mp4'), join(root, 'alias.mp4'));
  assert.equal(safeJoin(root, '/alias.mp4'), join(root, 'alias.mp4'));
});

test('over a real socket: traversal attempts never return a file from outside', async () => {
  for (const p of [
    '/../outside/secret.txt',
    '/%2e%2e/outside/secret.txt',
    '/..%2foutside/secret.txt',
    '/%252e%252e/outside/secret.txt',
    '/../rootbc/secret.txt',
    '//etc/passwd',
    '/clip.mp4%00.png',
    '/escape-file.txt',
    '/escape-dir/secret.txt',
  ]) {
    const text = await rawGet(p);
    assert.doesNotMatch(text, /SECRET/, `leaked via ${p}`);
    assert.notEqual(statusOf(text), 200, `${p} must not be 200`);
  }
});

// ---------------------------------------------------------------------------
// Range: Safari will not play a <video> whose server answers 200 to a ranged
// request. The TV just stays black. Real file, real loopback socket.
// ---------------------------------------------------------------------------

test('a normal GET is 200, full length, byte-identical, and advertises ranges', async () => {
  const { res, body } = await get('/clip.mp4');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('accept-ranges'), 'bytes');
  assert.equal(res.headers.get('content-type'), 'video/mp4');
  assert.equal(res.headers.get('content-length'), String(SIZE));
  assert.ok(body.equals(CLIP));
});

test('bytes=0-99 is a 206 with the exact first 100 bytes', async () => {
  const { res, body } = await get('/clip.mp4', 'bytes=0-99');
  assert.equal(res.status, 206);
  assert.equal(res.headers.get('content-range'), `bytes 0-99/${SIZE}`);
  assert.equal(res.headers.get('content-length'), '100');
  assert.equal(res.headers.get('accept-ranges'), 'bytes');
  assert.equal(res.headers.get('content-type'), 'video/mp4');
  assert.ok(body.equals(CLIP.subarray(0, 100)));
});

test('a middle range is byte-identical to that slice', async () => {
  const { res, body } = await get('/clip.mp4', 'bytes=2500-4999');
  assert.equal(res.status, 206);
  assert.equal(res.headers.get('content-range'), `bytes 2500-4999/${SIZE}`);
  assert.equal(res.headers.get('content-length'), '2500');
  assert.ok(body.equals(CLIP.subarray(2500, 5000)));
});

test('an open-ended range bytes=100- runs to the end of the file', async () => {
  const { res, body } = await get('/clip.mp4', 'bytes=100-');
  assert.equal(res.status, 206);
  assert.equal(res.headers.get('content-range'), `bytes 100-${SIZE - 1}/${SIZE}`);
  assert.equal(res.headers.get('content-length'), String(SIZE - 100));
  assert.ok(body.equals(CLIP.subarray(100)));
});

test('a suffix range bytes=-100 is the last 100 bytes', async () => {
  const { res, body } = await get('/clip.mp4', 'bytes=-100');
  assert.equal(res.status, 206);
  assert.equal(res.headers.get('content-range'), `bytes ${SIZE - 100}-${SIZE - 1}/${SIZE}`);
  assert.equal(res.headers.get('content-length'), '100');
  assert.ok(body.equals(CLIP.subarray(SIZE - 100)));
});

test('a suffix longer than the file is the whole file as a 206', async () => {
  const { res, body } = await get('/clip.mp4', `bytes=-${SIZE * 3}`);
  assert.equal(res.status, 206);
  assert.equal(res.headers.get('content-range'), `bytes 0-${SIZE - 1}/${SIZE}`);
  assert.ok(body.equals(CLIP));
});

test('Safari-style probes: bytes=0-1 and bytes=0- both get 206', async () => {
  const a = await get('/clip.mp4', 'bytes=0-1');
  assert.equal(a.res.status, 206);
  assert.equal(a.res.headers.get('content-range'), `bytes 0-1/${SIZE}`);
  assert.ok(a.body.equals(CLIP.subarray(0, 2)));
  const b = await get('/clip.mp4', 'bytes=0-');
  assert.equal(b.res.status, 206);
  assert.equal(b.res.headers.get('content-range'), `bytes 0-${SIZE - 1}/${SIZE}`);
  assert.ok(b.body.equals(CLIP));
});

test('single-byte ranges at both edges', async () => {
  const first = await get('/clip.mp4', 'bytes=0-0');
  assert.equal(first.res.status, 206);
  assert.ok(first.body.equals(CLIP.subarray(0, 1)));
  const last = await get('/clip.mp4', `bytes=${SIZE - 1}-${SIZE - 1}`);
  assert.equal(last.res.status, 206);
  assert.equal(last.res.headers.get('content-range'), `bytes ${SIZE - 1}-${SIZE - 1}/${SIZE}`);
  assert.ok(last.body.equals(CLIP.subarray(SIZE - 1)));
});

test('an end past the file is clamped to the last byte', async () => {
  const { res, body } = await get('/clip.mp4', `bytes=${SIZE - 10}-${SIZE + 5000}`);
  assert.equal(res.status, 206);
  assert.equal(res.headers.get('content-range'), `bytes ${SIZE - 10}-${SIZE - 1}/${SIZE}`);
  assert.equal(res.headers.get('content-length'), '10');
  assert.ok(body.equals(CLIP.subarray(SIZE - 10)));
});

test('a range starting past the end is a 416 with Content-Range: bytes */size', async () => {
  for (const r of [`bytes=${SIZE}-${SIZE + 10}`, 'bytes=50000-60000', `bytes=${SIZE}-`, 'bytes=-0', 'bytes=99999999999-']) {
    const { res, body } = await get('/clip.mp4', r);
    assert.equal(res.status, 416, r);
    assert.equal(res.headers.get('content-range'), `bytes */${SIZE}`, r);
    assert.equal(body.length, 0, r);
  }
});

test('a malformed or unsupported Range is ignored: 200 with the whole file', async () => {
  for (const r of ['bytes=abc', 'bytes=', 'bytes=-', 'bytes', 'items=0-5', 'bytes=0-5,10-20', 'bytes=5-2', 'bytes=--5', '0-5', 'bytes=1e3-2e3', 'bytes=-5-']) {
    const { res, body } = await get('/clip.mp4', r);
    assert.equal(res.status, 200, r);
    assert.equal(res.headers.get('accept-ranges'), 'bytes', r);
    assert.ok(body.equals(CLIP), `body for ${r}`);
  }
});

test('HEAD gets the headers (with and without Range) and no body', async () => {
  const head = (range) => new Promise((ok, fail) => {
    const req = request({ host, port, path: '/clip.mp4', method: 'HEAD', headers: range ? { Range: range } : {} }, (res) => {
      let n = 0; res.on('data', (c) => { n += c.length; }); res.on('end', () => ok({ res, n }));
    });
    req.on('error', fail); req.end();
  });
  const a = await head();
  assert.equal(a.res.statusCode, 200); assert.equal(a.n, 0);
  assert.equal(a.res.headers['content-length'], String(SIZE));
  assert.equal(a.res.headers['accept-ranges'], 'bytes');
  const b = await head('bytes=0-99');
  assert.equal(b.res.statusCode, 206); assert.equal(b.n, 0);
  assert.equal(b.res.headers['content-range'], `bytes 0-99/${SIZE}`);
});

test('an empty file: unranged is 200/0, any range is 416', async () => {
  const a = await get('/empty.mp4');
  assert.equal(a.res.status, 200);
  assert.equal(a.body.length, 0);
  const b = await get('/empty.mp4', 'bytes=0-');
  assert.equal(b.res.status, 416);
  assert.equal(b.res.headers.get('content-range'), 'bytes */0');
  const c = await get('/empty.mp4', 'bytes=-5');
  assert.equal(c.res.status, 416);
});

test('a real card file: ranged slices are byte-identical', async (t) => {
  const here = fileURLToPath(new URL('..', import.meta.url));
  const card = join(here, 'cards', 'alba-4x9.mp4');
  if (!existsSync(card)) { t.skip('no built cards on this machine'); return; }
  const bytes = readFileSync(card);
  const cardServer = createServer((req, res) => serveFile(req, res, card));
  await new Promise((r) => cardServer.listen(0, '127.0.0.1', r));
  try {
    const url = `http://127.0.0.1:${cardServer.address().port}/`;
    for (const [range, from, to] of [['bytes=0-1', 0, 2], ['bytes=0-', 0, bytes.length], [`bytes=${bytes.length - 500}-`, bytes.length - 500, bytes.length], ['bytes=-1000', bytes.length - 1000, bytes.length]]) {
      const res = await fetch(url, { headers: { Range: range } });
      assert.equal(res.status, 206, range);
      assert.ok(Buffer.from(await res.arrayBuffer()).equals(bytes.subarray(from, to)), range);
    }
  } finally { cardServer.closeAllConnections?.(); cardServer.close(); }
});

test('a client that drops mid-file does not hurt the server', async () => {
  await new Promise((ok) => {
    const req = request({ host, port, path: '/big.mp4' }, (res) => {
      res.once('data', () => { req.destroy(); ok(); });
    });
    req.on('error', () => {});
    req.end();
  });
  const { res } = await get('/clip.mp4', 'bytes=0-9');
  assert.equal(res.status, 206);
});

test('a missing file, a directory and a non-GET', async () => {
  assert.equal((await fetch(`${origin}/nope.mp4`)).status, 404);
  assert.equal((await fetch(`${origin}/sub`)).status, 404);
  assert.equal((await fetch(`${origin}/`)).status, 404);
  assert.equal((await fetch(`${origin}/clip.mp4`, { method: 'DELETE' })).status, 405);
});

test('safeJoin refusals are 403 over the wire', async () => {
  assert.equal(statusOf(await rawGet('/%2e%2e/outside/secret.txt')), 403);
  assert.equal(statusOf(await rawGet('/.hidden')), 403);
});

test('html is served no-cache so a reload always gets the new surface', async () => {
  const res = await fetch(`${origin}/page.html`);
  assert.match(res.headers.get('cache-control'), /no-store|no-cache/);
  assert.equal(res.headers.get('content-type'), 'text/html; charset=utf-8');
});
