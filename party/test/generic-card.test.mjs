import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, statSync, existsSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { buildGenericCard, buildFilterGraph, cardLines, fitFontSize, GEOMETRY } from '../build/generic-card.mjs';

const haveFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0
  && spawnSync('ffprobe', ['-version']).status === 0;
const FLAGS = new URL('../assets/flags/', import.meta.url).pathname;

function probe(path) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height:format=duration', '-of', 'json', path]);
  assert.equal(r.status, 0, r.stderr.toString());
  const j = JSON.parse(r.stdout.toString());
  return { width: j.streams[0].width, height: j.streams[0].height, duration: Number(j.format.duration) };
}

test('hometown takes the gold line and the country goes beneath', () => {
  assert.deepEqual(
    cardLines({ name: 'Kevin Kozlowski', hometown: 'Endicott, NY', country: 'USA' }),
    { name: 'KEVIN KOZLOWSKI', gold: 'ENDICOTT, NY', white: 'USA' },
  );
});

test('with no hometown the country takes the gold line', () => {
  assert.deepEqual(
    cardLines({ name: 'Sridhar Muthusamy', hometown: '', country: 'India' }),
    { name: 'SRIDHAR MUTHUSAMY', gold: 'INDIA', white: '' },
  );
});

test('a long name shrinks to fit, a short one does not', () => {
  assert.equal(fitFontSize('SETH HOLLADAY', 36, 17), 36);
  assert.equal(fitFontSize('SRIDHAR MUTHUSAMY', 36, 17), 36);
  assert.equal(fitFontSize('BARTHOLOMEW CUMBERBATCH-JONES', 36, 17), 21);
});

test('geometry fills a 16:9 screen exactly', () => {
  assert.equal(GEOMETRY['4x9'].width * 4, 1920);
  assert.equal(GEOMETRY['8x9'].width * 2, 1920);
  assert.equal(GEOMETRY['4x9'].height, 1080);
  assert.equal(GEOMETRY['8x9'].height, 1080);
});

test('filter graph never inlines player text; it goes through textfile= with expansion=none', () => {
  const lines = cardLines({ name: "Seamus O'Brien", hometown: 'Great Falls, VA', country: 'USA' });
  const graph = buildFilterGraph(GEOMETRY['4x9'], lines, { name: 't-name.txt', gold: 't-gold.txt', white: 't-white.txt' });
  assert.equal((graph.match(/drawtext=/g) || []).length, 3);
  assert.equal((graph.match(/textfile=/g) || []).length, 3);
  assert.equal((graph.match(/expansion=none/g) || []).length, 3);
  assert.ok(!/[:,]text=/.test(graph), 'no inline text=');
  assert.ok(!graph.includes("O'BRIEN") && !graph.includes('GREAT FALLS'), 'player text must not appear in the graph');
});

test('rejects without touching outPath when the flag or format is bad', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'card-'));
  const out = join(dir, 'x.mp4');
  writeFileSync(out, 'precious');
  await assert.rejects(buildGenericCard({ player: { name: 'Ann Test', country: 'Atlantis' }, format: '4x9', outPath: out, flagsDir: FLAGS, workDir: dir }),
    /Ann Test \[4x9\].*Atlantis/s);
  await assert.rejects(buildGenericCard({ player: { name: 'Ann Test', country: 'USA' }, format: '5x9', outPath: out, flagsDir: FLAGS, workDir: dir }),
    /Ann Test \[5x9\]/);
  assert.equal(readFileSync(out, 'utf8'), 'precious');
});

test('a corrupt flag file is rejected up front (ffmpeg would spin on it) and outPath is untouched', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'card-'));
  const out = join(dir, 'x.mp4');
  writeFileSync(out, 'precious');
  const bad = join(dir, 'flags');
  mkdirSync(bad);
  writeFileSync(join(bad, 'us.png'), 'not a png');
  await assert.rejects(buildGenericCard({ player: { name: 'Ann Test', country: 'USA' }, format: '8x9', outPath: out, flagsDir: bad, workDir: dir }),
    /Ann Test \[8x9\].*not a PNG/s);
  assert.equal(readFileSync(out, 'utf8'), 'precious');
});

test('SLOW: a failed or killed ffmpeg names the player and format and leaves outPath and the directory untouched',
  { skip: !haveFfmpeg, timeout: 60_000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'card-'));
    const out = join(dir, 'x.mp4');
    writeFileSync(out, 'precious');
    await assert.rejects(buildGenericCard({ player: { name: 'Ann Test', country: 'USA' }, format: '8x9', outPath: out, flagsDir: FLAGS, workDir: dir, timeoutMs: 300 }),
      /Ann Test \[8x9\]/);
    assert.equal(readFileSync(out, 'utf8'), 'precious');
    assert.deepEqual(readdirSync(dir), ['x.mp4']);
  });

test('a missing ffmpeg rejects clearly and leaves nothing behind', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'card-'));
  const out = join(dir, 'x.mp4');
  const savedPath = process.env.PATH;
  process.env.PATH = dir; // an empty directory: no ffmpeg
  try {
    await assert.rejects(buildGenericCard({ player: { name: 'Ann Test', country: 'USA' }, format: '4x9', outPath: out, flagsDir: FLAGS, workDir: dir }),
      /Ann Test \[4x9\].*ffmpeg was not found/s);
  } finally {
    process.env.PATH = savedPath;
  }
  assert.ok(!existsSync(out));
  assert.deepEqual(readdirSync(dir), []);
});

// SLOW / integration: real ffmpeg renders into a temp directory. Skipped without ffmpeg.
// REVIEW FOCUS: a comma or an apostrophe must survive drawtext intact.
test('SLOW: renders a name with an apostrophe and a hometown with a comma', { skip: !haveFfmpeg, timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'card-'));
  const out = join(dir, 'obrien-4x9.mp4');
  const res = await buildGenericCard({
    player: { name: "Seamus O'Brien", hometown: "Coeur d'Alene, ID", country: 'USA' },
    format: '4x9', outPath: out, flagsDir: FLAGS, workDir: dir,
  });
  assert.equal(res, out);
  assert.ok(statSync(out).size > 50_000);
  const p = probe(out);
  assert.deepEqual([p.width, p.height], [480, 1080]);
  assert.ok(Math.abs(p.duration - 9) < 0.1, `duration ${p.duration}`);
  assert.deepEqual(readdirSync(dir), ['obrien-4x9.mp4']);
});

test('SLOW: builds an 8x9 card at the right size, with a comma in the hometown', { skip: !haveFfmpeg, timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'card-'));
  const out = join(dir, 'ann-8x9.mp4');
  await buildGenericCard({
    player: { name: "Ann O'Neil-Smith", hometown: 'Washington, DC', country: 'USA' },
    format: '8x9', outPath: out, flagsDir: FLAGS, workDir: dir,
  });
  assert.ok(statSync(out).size > 50_000);
  const p = probe(out);
  assert.deepEqual([p.width, p.height], [960, 1080]);
  assert.ok(Math.abs(p.duration - 9) < 0.1, `duration ${p.duration}`);
});

test('SLOW: a card with no hometown (country only) renders', { skip: !haveFfmpeg, timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'card-'));
  const out = join(dir, 'sri-4x9.mp4');
  await buildGenericCard({
    player: { name: 'Sridhar Muthusamy', hometown: '', country: 'India' },
    format: '4x9', outPath: out, flagsDir: FLAGS, workDir: dir,
  });
  const p = probe(out);
  assert.deepEqual([p.width, p.height], [480, 1080]);
});

// YMAX of the last decoded frame, via signalstats (the same measure the coordinator used).
function finalFrameYmax(path) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', path, '-vf',
    'signalstats,metadata=print:key=lavfi.signalstats.YMAX:file=-', '-f', 'null', '-']);
  assert.equal(r.status, 0, r.stderr.toString());
  const all = [...r.stdout.toString().matchAll(/YMAX=(\d+)/g)].map((m) => Number(m[1]));
  assert.ok(all.length >= 269, `expected ~270 frames, got ${all.length}`);
  return all.at(-1);
}

test('SLOW: the final frame stays bright (card holds as the info panel, no fade-out)', { skip: !haveFfmpeg, timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'card-'));
  for (const format of ['4x9', '8x9']) {
    const out = join(dir, `hold-${format}.mp4`);
    await buildGenericCard({ player: { name: 'Ann Test', hometown: 'Washington, DC', country: 'USA' },
      format, outPath: out, flagsDir: FLAGS, workDir: dir });
    const ymax = finalFrameYmax(out);
    assert.ok(ymax > 200, `${format} final frame YMAX ${ymax}`);
  }
});

test('SLOW: a relative flagsDir, workDir and outPath work', { skip: !haveFfmpeg, timeout: 120_000 }, async () => {
  const { relative } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'card-'));
  const rel = (p) => relative(process.cwd(), p);
  const out = join(dir, 'rel-4x9.mp4');
  const res = await buildGenericCard({ player: { name: "Pat O'Brien", hometown: 'Reno, NV', country: 'USA' },
    format: '4x9', outPath: rel(out), flagsDir: rel(FLAGS), workDir: rel(dir) });
  assert.equal(res, rel(out));
  assert.deepEqual([probe(out).width, probe(out).height], [480, 1080]);
});
