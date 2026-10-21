import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { yearOf, mixByYear, walk } from '../build/build-photos.mjs';

// --- which tournament a photograph belongs to --------------------------------

test('the year comes off the folder, which is what a Google Photos export names', () => {
  assert.equal(yearOf('/x/Lansdowne International Cup 2021-1-001/IMG_1207.HEIC'), '2021');
  assert.equal(yearOf('/x/Lansdowne International Cup 2025-1-001/sub/IMG_1.jpg'), '2025');
  assert.equal(yearOf('/x/International Cup 2023/a.jpg'), '2023');
});

test('a file name that merely contains digits is not a year', () => {
  // The folder is asked first precisely so these cannot win. IMG_2025.jpg in
  // the 2021 album is a photograph from 2021, and 20231016_144501.jpg is a
  // camera's timestamp, not four digits followed by something that ends it.
  assert.equal(yearOf('/x/Cup 2021-1-001/IMG_2025.jpg'), '2021');
  assert.equal(yearOf('/x/Cup 2023/20231016_144501.jpg'), '2023');
  assert.equal(yearOf('/x/album/20231016_144501.jpg'), '');
  assert.equal(yearOf('/x/album/DSC_0042.jpg'), '');
});

test('a photograph that will not say which year it is from is still a photograph', () => {
  // Grouped under '' and played like any other: dropping somebody's picture
  // because a folder was renamed would be the wrong way round.
  assert.equal(yearOf('/x/holiday/a.jpg'), '');
  assert.equal(yearOf(''), '');
  assert.equal(yearOf('a.jpg'), '');
});

test('a year outside the ones a tournament could have is not read as one', () => {
  assert.equal(yearOf('/x/1999 album/a.jpg'), '');
  assert.equal(yearOf('/x/2050 album/a.jpg'), '');
});

// --- the order the room sees -------------------------------------------------

test('the years interleave, so the room is not shown one album at a time', () => {
  const photos = [];
  for (const year of ['2021', '2022', '2023']) {
    for (let i = 0; i < 4; i++) photos.push({ year, src: `${year}-${i}` });
  }
  const out = mixByYear(photos);
  assert.equal(out.length, 12);
  // No two neighbours from the same tournament while every year still has
  // pictures left: that is the whole point of the round robin.
  for (let i = 1; i < out.length; i++) {
    assert.notEqual(out[i].year, out[i - 1].year, `${i}: ${out[i - 1].src} then ${out[i].src}`);
  }
});

test('an album that runs out does not stop the rest, and nothing is lost', () => {
  const photos = [
    { year: '2021', src: 'a' },
    { year: '2022', src: 'b' }, { year: '2022', src: 'c' }, { year: '2022', src: 'd' },
  ];
  const out = mixByYear(photos);
  assert.equal(out.length, 4);
  assert.deepEqual([...out.map((p) => p.src)].sort(), ['a', 'b', 'c', 'd']);
});

test('the mix is deterministic, so a rebuild does not reshuffle a running show', () => {
  const photos = Array.from({ length: 30 }, (_, i) => ({ year: String(2021 + (i % 5)), src: `s${i}` }));
  assert.deepEqual(mixByYear(photos).map((p) => p.src), mixByYear(photos).map((p) => p.src));
  // A different seed does give a different order - otherwise the shuffle above
  // would be passing for the wrong reason.
  assert.notDeepEqual(mixByYear(photos).map((p) => p.src), mixByYear(photos, 7).map((p) => p.src));
});

test('an empty album is an empty show, not a crash', () => {
  assert.deepEqual(mixByYear([]), []);
});

// --- what counts as a photograph ---------------------------------------------

function album() {
  const dir = mkdtempSync(join(tmpdir(), 'album-'));
  const put = (rel, text = 'x') => {
    const full = join(dir, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, text);
    return full;
  };
  return { dir, put };
}

test('pictures are found at any depth, and the things that are not pictures are left', () => {
  const { dir, put } = album();
  put('Cup 2021/IMG_1.jpg');
  put('Cup 2021/IMG_2.HEIC');          // an iPhone export keeps HEIC
  put('Cup 2022/nested/IMG_3.jpeg');
  put('Cup 2022/IMG_4.PNG');
  put('Cup 2022/clip.mp4');            // Google Photos albums carry video too
  put('Cup 2022/clip.MOV');
  put('Cup 2022/metadata.json');
  put('Cup 2022/.DS_Store');
  put('Cup 2022/.hidden.jpg');
  const found = walk(dir).map((f) => f.split('/').pop()).sort();
  assert.deepEqual(found, ['IMG_1.jpg', 'IMG_2.HEIC', 'IMG_3.jpeg', 'IMG_4.PNG']);
});

test('the folders an export carries that hold no photographs are skipped', () => {
  const { dir, put } = album();
  put('Cup 2021/IMG_1.jpg');
  put('__MACOSX/Cup 2021/._IMG_1.jpg');
  put('thumbnails/IMG_1.jpg');
  put('.git/objects/IMG_1.jpg');
  assert.deepEqual(walk(dir).map((f) => f.split('/').pop()), ['IMG_1.jpg']);
});

test('a folder that cannot be read costs that folder, not the run', () => {
  const { dir, put } = album();
  put('Cup 2021/IMG_1.jpg');
  const shut = join(dir, 'Cup 2022');
  mkdirSync(shut, { recursive: true });
  writeFileSync(join(shut, 'IMG_9.jpg'), 'x');
  chmodSync(shut, 0o000);                       // readdirSync throws EACCES on this
  try {
    assert.deepEqual(walk(dir).map((f) => f.split('/').pop()), ['IMG_1.jpg']);
  } finally {
    chmodSync(shut, 0o755);                     // or the temp dir cannot be cleaned up
  }
  assert.deepEqual(walk(join(dir, 'does-not-exist')), []);
});

test('a dangling symlink is not mistaken for a folder to walk into', () => {
  const { dir, put } = album();
  put('Cup 2021/IMG_1.jpg');
  symlinkSync(join(dir, 'nowhere'), join(dir, 'Cup 2022'));
  symlinkSync(join(dir, 'nowhere.jpg'), join(dir, 'Cup 2021/broken.jpg'));
  // The broken link ends in .jpg, so it IS collected - and that is the right
  // answer here rather than a stat on every entry: sips fails on it, build()
  // counts it unreadable and says so, and the run carries on.
  assert.deepEqual(walk(dir).map((f) => f.split('/').pop()).sort(), ['IMG_1.jpg', 'broken.jpg']);
});
