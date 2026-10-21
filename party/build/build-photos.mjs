#!/usr/bin/env node
// Turns a folder of photographs from past years into the slideshow the stage
// can play. Run it over whatever came out of Google Photos:
//
//   node party/build/build-photos.mjs ~/Downloads/ic-photos
//
// Several folders at once is fine, and so is running it again after adding
// more: a photograph already built is left alone, so the second run costs
// seconds rather than minutes.
//
// Everything lands in party/photos/, which is gitignored and is not one of the
// directories the website's deploy copies. These are other people's faces at
// private parties and they stay on the laptop.
import { readdirSync, statSync, mkdirSync, existsSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const PARTY = resolve(HERE, '..');
const OUT_DIR = join(PARTY, 'photos');
const MANIFEST = join(OUT_DIR, 'manifest.json');

// What a camera, a phone or a Google Photos export might hand us. HEIC is in
// the list because an iPhone export keeps it, and a browser will not show one.
const EXTS = new Set(['.jpg', '.jpeg', '.png', '.heic', '.heif', '.webp', '.tif', '.tiff']);

// A television is 1920 wide. Anything bigger is bytes the stage has to decode
// between one photograph and the next, and the room cannot see the difference.
const MAX_EDGE = 1920;
const QUALITY = 'high';

// Folders an export is likely to carry that hold no photographs of anybody.
const SKIP_DIRS = new Set(['.git', '.DS_Store', '__MACOSX', 'thumbnails', 'print-subset']);

export function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;              // unreadable folder: say so once, at the top, not here
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(full, out);
    } else if (EXTS.has(extname(e.name).toLowerCase())) {
      out.push(full);
    }
  }
  return out;
}

// Which tournament a photograph belongs to. A Google Photos album downloads as
// a folder carrying its own name ("Lansdowne International Cup 2023-1-001"), so
// the year is almost always sitting in the FOLDER - and the folder is asked
// first on purpose. A file called IMG_2025.jpg inside the 2021 album is not a
// photograph from 2025, and a camera name like 20231016_144501.jpg must not be
// read as a year either, which is what the non-digit after the four digits is
// for. A photograph that will not say gets grouped under "" and still plays.
function yearIn(text) {
  const all = String(text).match(/(?:^|[^0-9])(20[0-2][0-9])(?:[^0-9]|$)/g);
  if (!all || all.length === 0) return '';
  const last = all[all.length - 1].match(/20[0-2][0-9]/);
  return last ? last[0] : '';
}

export function yearOf(path) {
  return yearIn(dirname(String(path))) || yearIn(basename(String(path)));
}

// A deterministic shuffle. The point is that the years INTERLEAVE: played in
// file order the room gets two hundred photographs of 2021 and then two hundred
// of 2022, and everyone stops looking a third of the way through. Seeded, so a
// rebuild does not reshuffle a running show into a different order.
export function mixByYear(photos, seed = 20261022) {
  const byYear = new Map();
  for (const p of photos) {
    if (!byYear.has(p.year)) byYear.set(p.year, []);
    byYear.get(p.year).push(p);
  }
  // mulberry32: tiny, and we only need "well spread", not cryptography.
  let s = seed >>> 0;
  const rnd = () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const queues = [...byYear.keys()].sort().map((y) => {
    const list = byYear.get(y).slice();
    for (let i = list.length - 1; i > 0; i--) {     // Fisher-Yates, seeded
      const j = Math.floor(rnd() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  });
  // Round-robin across the years, so consecutive photographs are from different
  // tournaments and the slideshow reads as a history rather than a dump.
  const out = [];
  let moved = true;
  while (moved) {
    moved = false;
    for (const q of queues) {
      const next = q.shift();
      if (next) { out.push(next); moved = true; }
    }
  }
  return out;
}

function sips(args) {
  const r = spawnSync('/usr/bin/sips', args, { encoding: 'utf8' });
  return r && r.status === 0 ? String(r.stdout || '') : null;
}

function dimensions(path) {
  const out = sips(['-g', 'pixelWidth', '-g', 'pixelHeight', path]);
  if (!out) return null;
  const w = out.match(/pixelWidth:\s*(\d+)/);
  const h = out.match(/pixelHeight:\s*(\d+)/);
  return w && h ? { w: Number(w[1]), h: Number(h[1]) } : null;
}

// sips applies the EXIF orientation while converting, which is the whole reason
// for going through it rather than copying a JPEG straight across: a phone
// photograph copied verbatim arrives in the browser on its side.
function convert(src, dest, longEdge) {
  const args = ['-s', 'format', 'jpeg', '-s', 'formatOptions', QUALITY];
  if (longEdge > MAX_EDGE) args.push('-Z', String(MAX_EDGE));
  args.push(src, '--out', dest);
  return sips(args) !== null;
}

export function build(sources, { log = console.log } = {}) {
  mkdirSync(OUT_DIR, { recursive: true });

  const files = [];
  for (const dir of sources) {
    const abs = resolve(dir);
    if (!existsSync(abs)) { log(`  [!!] no such folder: ${abs}`); continue; }
    const found = walk(abs);
    log(`  ${found.length} image${found.length === 1 ? '' : 's'} under ${abs}`);
    files.push(...found);
  }
  if (files.length === 0) {
    log('\n  Nothing to do. Point this at the folder your photographs are in.\n');
    return { photos: [], built: 0, skipped: 0 };
  }

  // Re-running must be cheap, so a source file is keyed by its own path, size
  // and mtime. Change the file and it rebuilds; leave it and it does not.
  const previous = new Map();
  if (existsSync(MANIFEST)) {
    try {
      for (const p of JSON.parse(readFileSync(MANIFEST, 'utf8')).photos || []) {
        if (p && p.key) previous.set(p.key, p);
      }
    } catch { /* a corrupt manifest just means we build the lot again */ }
  }

  const photos = [];
  const used = new Set();
  let built = 0;
  let skipped = 0;
  let failed = 0;
  let n = 0;

  for (const src of files) {
    n += 1;
    let st;
    try { st = statSync(src); } catch { failed += 1; continue; }
    const key = `${src}|${st.size}|${Math.round(st.mtimeMs)}`;
    const year = yearOf(src);

    const hit = previous.get(key);
    if (hit && existsSync(join(PARTY, hit.src))) {
      photos.push({ ...hit, year });
      used.add(basename(hit.src));
      skipped += 1;
      continue;
    }

    const name = `${year || 'x'}-${String(n).padStart(4, '0')}.jpg`;
    const dest = join(OUT_DIR, name);
    const dim = dimensions(src);
    if (!dim) { log(`  [!!] cannot read ${src}`); failed += 1; continue; }
    if (!convert(src, dest, Math.max(dim.w, dim.h))) {
      log(`  [!!] cannot convert ${src}`);
      failed += 1;
      continue;
    }
    const after = dimensions(dest) || dim;
    photos.push({ key, src: `photos/${name}`, year, w: after.w, h: after.h });
    used.add(name);
    built += 1;
    if (built % 25 === 0) log(`  ...${built} built`);
  }

  // A photograph removed from the source folder must leave the show, and its
  // file must leave the disk - otherwise the slideshow keeps playing a picture
  // somebody asked to have taken out.
  let removed = 0;
  for (const f of readdirSync(OUT_DIR)) {
    if (f === 'manifest.json' || used.has(f)) continue;
    try { rmSync(join(OUT_DIR, f)); removed += 1; } catch { /* leave it */ }
  }

  const ordered = mixByYear(photos);
  writeFileSync(MANIFEST, `${JSON.stringify({
    built: new Date().toISOString(),
    photos: ordered,
  }, null, 2)}\n`);

  const years = [...new Set(ordered.map((p) => p.year || 'unknown'))].sort();
  log('');
  log(`  party/photos: ${ordered.length} photographs (${built} built, ${skipped} already done${failed ? `, ${failed} unreadable` : ''}${removed ? `, ${removed} removed` : ''})`);
  log(`  years: ${years.join(', ')}`);
  log('');
  log('  Now run: npm run party:build   (that is what puts them in the show)');
  log('');
  return { photos: ordered, built, skipped, failed, removed };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const sources = process.argv.slice(2);
  if (sources.length === 0) {
    console.log(`
  Give me the folder your photographs are in:

    node party/build/build-photos.mjs ~/Downloads/ic-photos

  Several folders at once is fine. Everything is written to party/photos/,
  which never leaves this laptop.
`);
    process.exit(1);
  }
  build(sources);
}
