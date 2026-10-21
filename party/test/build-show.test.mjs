import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  validateCards, indexShow, planCards, buildShow, BuildError, ProbeUnavailable, filmLoopOrder, loadPhotos,
} from '../build/build-show.mjs';
import CARD_KEYS from '../build/card-keys.json' with { type: 'json' };

// Synthetic players only: no real names, towns or schools in the repo.
function fixture({ bespoke = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'show-'));
  const mk = (n, country) => Array.from({ length: n }, (_, i) =>
    ({ name: `Player ${country} ${i + 1}`, country, hometown: 'Testville', school: '' }));
  const detailsPath = join(dir, 'details.json');
  writeFileSync(detailsPath, JSON.stringify({ teams: { international: mk(26, 'England'), usa: mk(26, 'USA') } }));
  mkdirSync(join(dir, 'cards'));
  for (const key of Object.values(bespoke)) {
    writeFileSync(join(dir, 'cards', `${key}-4x9.mp4`), 'x');
    writeFileSync(join(dir, 'cards', `${key}-8x9.mp4`), 'x');
  }
  return { dir, detailsPath, cardsDir: join(dir, 'cards'), cardKeys: {} };
}
const players = (n = 3) => Array.from({ length: n }, (_, i) =>
  ({ id: `player-intl-${i + 1}`, team: 'international', name: `P${i + 1}`, country: 'England', hometown: '', school: '' }));
const okProbe = (abs) => ({ codec: 'h264', pixFmt: 'yuv420p', width: abs.includes('4x9') ? 480 : 960, height: 1080, duration: 9 });

test('every player in the show has a film, or no card key at all, or no hometown yet', () => {
  const show = JSON.parse(readFileSync(new URL('../show.json', import.meta.url), 'utf8'));
  const keyed = show.players.filter((p) => !p.generic);
  const noFilm = keyed.filter((p) => !p.film).map((p) => p.name);
  assert.equal(keyed.length, 46);
  // Jun Bae has given no hometown, so for him there is nowhere to fly to.
  // Everyone else with a card has a film.
  assert.equal(noFilm.length, 1, `without a film: ${noFilm.join(', ')}`);
  for (const p of keyed) {
    if (!p.film) continue;
    assert.match(p.film, /^cards\/[a-z]+-16x9-web\.mp4$/);
    assert.ok(existsSync(new URL(`../${p.film}`, import.meta.url)), p.film);
  }
});

test("the films loop alternates the sides and repeats no country or state, round the loop", () => {
  const show = JSON.parse(readFileSync(new URL('../show.json', import.meta.url), 'utf8'));
  const films = show.players.filter((p) => p.film);
  const by = new Map(show.players.map((p) => [p.id, p]));
  assert.equal(show.filmOrder.length, films.length, 'every film is in the order, once');
  assert.equal(new Set(show.filmOrder).size, films.length);
  const seq = show.filmOrder.map((id) => by.get(id));
  const state = (p) => (p.hometown ? p.hometown.split(',').pop().trim() : '-');
  const n = seq.length;
  for (let i = 0; i < n; i++) {
    const a = seq[i];
    const b = seq[(i + 1) % n];           // % n: the loop plays round again
    assert.ok(a.team === 'international' || b.team === 'international',
      `${a.name} and ${b.name} are both US films, back to back`);
    if (a.team === 'international' && b.team === 'international') {
      assert.notEqual(a.country, b.country, `${a.name} then ${b.name}, both ${a.country}`);
    }
  }
  // Erik's rule for the US side is about consecutive US FILMS, which an
  // International sits between: ...Rizzo, someone, Kritsberg... is two New York
  // films either side of one gap unless the states are checked in their own
  // sequence. Same for the Internationals' countries.
  for (const [side, key] of [['international', (p) => p.country], ['usa', state]]) {
    const sub = seq.filter((p) => (side === 'international'
      ? p.team === 'international' : p.team !== 'international'));
    for (let i = 0; i < sub.length; i++) {
      const a = sub[i];
      const b = sub[(i + 1) % sub.length];
      assert.notEqual(key(a), key(b), `${side}: ${a.name} then ${b.name}, both ${key(a)}`);
    }
  }
});

test('the order is the same every build, and survives a show with nothing to order', () => {
  const show = JSON.parse(readFileSync(new URL('../show.json', import.meta.url), 'utf8'));
  assert.deepEqual(filmLoopOrder(show.players), show.filmOrder, 'rebuilding does not reshuffle the night');
  // Never throws, never drops anyone: the order of a slideshow must not fail a build.
  for (const junk of [null, undefined, 'x', 7, {}, [null, 7, {}], [{ id: 'a' }]]) {
    assert.doesNotThrow(() => filmLoopOrder(junk), JSON.stringify(junk));
    assert.deepEqual(filmLoopOrder(junk), [], JSON.stringify(junk));
  }
  // One side empty is a real answer: the films still all play.
  const only = [
    { id: 'a', team: 'international', country: 'India', film: 'f' },
    { id: 'b', team: 'international', country: 'Korea', film: 'f' },
  ];
  assert.deepEqual([...filmLoopOrder(only)].sort(), ['a', 'b']);
});

test('the card-key map has 46 entries and keeps phil and phillip apart', () => {
  assert.equal(Object.keys(CARD_KEYS).length, 46);
  assert.equal(CARD_KEYS['Philip Woodisse'], 'phil');
  assert.equal(CARD_KEYS['Phillip Jewell'], 'phillip');
  // Two Baes, and they are not the same man: Yun Sang Bae has a film, Jun Bae
  // has no hometown and so has none.
  assert.equal(CARD_KEYS['Yun Sang Bae'], 'yun');
  assert.equal(CARD_KEYS['Jun Bae'], 'jun');
  assert.equal(new Set(Object.values(CARD_KEYS)).size, 46, 'no two players share a card');
});

test('every player gets both formats; keyed players with files are bespoke', () => {
  const f = fixture({ bespoke: { 'Player England 2': 'two' } });
  const plan = planCards(players(3).map((p, i) => ({ ...p, name: `Player England ${i + 1}` })),
    f.cardsDir, { 'Player England 2': 'two' });
  assert.equal(plan.length, 3);
  for (const p of plan) assert.match(p.cards['4x9'], /^cards\/.+-4x9\.mp4$/);
  const two = plan[1];
  assert.equal(two.generic, false);
  assert.equal(two.cards['4x9'], 'cards/two-4x9.mp4');
  assert.equal(two.fallback['4x9'], 'cards/player-intl-2-4x9.mp4');
  assert.equal(plan[0].generic, true);
  assert.deepEqual(plan[0].fallback, plan[0].cards);
});

test('a player with a film carries it; one without carries null, not a broken path', () => {
  const f = fixture({ bespoke: { 'Player England 1': 'one', 'Player England 2': 'two' } });
  // one has a film, two does not, three has no card at all.
  writeFileSync(join(f.cardsDir, 'one-16x9-web.mp4'), 'film');
  const plan = planCards(players(3).map((p, i) => ({ ...p, name: `Player England ${i + 1}` })),
    f.cardsDir, { 'Player England 1': 'one', 'Player England 2': 'two' });
  assert.equal(plan[0].film, 'cards/one-16x9-web.mp4');
  assert.equal(plan[1].film, null, 'no file, so no film - not cards/two-16x9-web.mp4');
  assert.equal(plan[2].film, null, 'a flag-card player has no film either');
  // The master is NOT what the stage plays: 38 of those is a gigabyte over venue wifi.
  writeFileSync(join(f.cardsDir, 'two-16x9.mp4'), 'master only');
  assert.equal(planCards(players(2).map((p, i) => ({ ...p, name: `Player England ${i + 1}` })),
    f.cardsDir, { 'Player England 2': 'two' })[1].film, null);
});

test('a film is validated as a film: 1920x1080 and half a minute', () => {
  const dir = mkdtempSync(join(tmpdir(), 'show-'));
  mkdirSync(join(dir, 'cards'));
  for (const n of ['a-4x9', 'a-8x9', 'a-16x9-web']) writeFileSync(join(dir, 'cards', `${n}.mp4`), 'bytes');
  const cards = { '4x9': 'cards/a-4x9.mp4', '8x9': 'cards/a-8x9.mp4' };
  const show = indexShow({ built: 'now', days: {}, players: [{
    id: 'p1', name: 'A', cards, fallback: cards, film: 'cards/a-16x9-web.mp4',
  }] });
  const film = { codec: 'h264', pixFmt: 'yuv420p', width: 1920, height: 1080, duration: 29.3 };
  const probe = (abs) => (abs.includes('16x9') ? film : okProbe(abs));
  assert.deepEqual(validateCards(show, dir, { probe }), []);

  // A card's size is not a film's size, and a film's half-minute is not a card's.
  const wrong = validateCards(show, dir, { probe: (a) => (a.includes('16x9') ? { ...film, width: 960 } : okProbe(a)) });
  assert.equal(wrong.length, 1);
  assert.ok(wrong[0].includes('a-16x9-web.mp4') && wrong[0].includes('expected 1920x1080'));
  const brief = validateCards(show, dir, { probe: (a) => (a.includes('16x9') ? { ...film, duration: 9 } : okProbe(a)) });
  assert.equal(brief.length, 1);
  assert.ok(brief[0].includes('implausible duration') && brief[0].includes('20-40s'));
  // 4:4:4 is what the films came out of the pipeline as, and what Safari will not decode.
  const odd = validateCards(show, dir, { probe: (a) => (a.includes('16x9') ? { ...film, pixFmt: 'yuvj444p' } : okProbe(a)) });
  assert.equal(odd.length, 1);
  assert.ok(odd[0].includes('h264,yuvj444p'));
  // A film named but empty is a half-finished encode, and is refused.
  writeFileSync(join(dir, 'cards', 'a-16x9-web.mp4'), '');
  const empty = validateCards(show, dir, { probe });
  assert.equal(empty.length, 1);
  assert.ok(empty[0].includes('zero-length') && empty[0].includes('a-16x9-web.mp4'));
});

test('a card key naming nobody is a build error', () => {
  assert.throws(() => planCards(players(), mkdtempSync(join(tmpdir(), 'c-')), { 'Nobody At All': 'nope' }),
    (e) => e instanceof BuildError && e.message.includes('Nobody At All'));
});

test('a card key whose files are missing is a build error, not a silent flag', () => {
  assert.throws(() => planCards(players(), mkdtempSync(join(tmpdir(), 'c-')), { P1: 'ghost' }),
    (e) => e instanceof BuildError && e.message.includes('ghost'));
});

test('validation catches a missing card and a zero-length one without needing ffprobe', () => {
  const dir = mkdtempSync(join(tmpdir(), 'show-'));
  mkdirSync(join(dir, 'cards'));
  writeFileSync(join(dir, 'cards', 'a-4x9.mp4'), '');
  const show = indexShow({
    built: 'now', days: { 1: [], 2: [] },
    players: [{ id: 'p1', name: 'A', cards: { '4x9': 'cards/a-4x9.mp4', '8x9': 'cards/a-8x9.mp4' } }],
  });
  const problems = validateCards(show, dir, { probe: okProbe });
  assert.equal(problems.length, 2);
  assert.ok(problems.some((p) => p.includes('zero-length') && p.includes('a-4x9.mp4')));
  assert.ok(problems.some((p) => p.includes('missing') && p.includes('a-8x9.mp4')));
});

function oneCardShow() {
  const dir = mkdtempSync(join(tmpdir(), 'show-'));
  mkdirSync(join(dir, 'cards'));
  for (const f of ['4x9', '8x9']) writeFileSync(join(dir, 'cards', `a-${f}.mp4`), 'bytes');
  const cards = { '4x9': 'cards/a-4x9.mp4', '8x9': 'cards/a-8x9.mp4' };
  return { dir, show: indexShow({ built: 'now', days: {}, players: [{ id: 'p1', name: 'A', cards, fallback: cards }] }) };
}

test('validation passes good files and probes each distinct file once', () => {
  const { dir, show } = oneCardShow();
  let calls = 0;
  assert.deepEqual(validateCards(show, dir, { probe: (a) => { calls++; return okProbe(a); } }), []);
  assert.equal(calls, 2);
});

test('validation reports wrong size, bad duration and unreadable files by file and reason', () => {
  const { dir, show } = oneCardShow();
  const wrong = validateCards(show, dir, { probe: (a) => ({ ...okProbe(a), width: 1920 }) });
  assert.equal(wrong.length, 2);
  assert.ok(wrong.some((p) => p.includes('a-4x9.mp4') && p.includes('1920x1080')));
  const short = validateCards(show, dir, { probe: (a) => ({ ...okProbe(a), duration: 0.04 }) });
  assert.equal(short.length, 2);
  assert.ok(short.every((p) => p.includes('implausible duration')));
  const long = validateCards(show, dir, { probe: (a) => ({ ...okProbe(a), duration: 600 }) });
  assert.equal(long.length, 2);
  const nan = validateCards(show, dir, { probe: (a) => ({ ...okProbe(a), duration: NaN }) });
  assert.equal(nan.length, 2);
  const bad = validateCards(show, dir, { probe: () => { throw new Error('it has no video stream'); } });
  assert.equal(bad.length, 2);
  assert.ok(bad[0].includes('unreadable') && bad[0].includes('no video stream'));
});

test('validation requires h264 and accepts both yuv420p and yuvj420p', () => {
  const { dir, show } = oneCardShow();
  assert.deepEqual(validateCards(show, dir, { probe: (a) => ({ ...okProbe(a), pixFmt: 'yuvj420p' }) }), []);
  const hevc = validateCards(show, dir, { probe: (a) => ({ ...okProbe(a), codec: 'hevc' }) });
  assert.equal(hevc.length, 2);
  assert.ok(hevc[0].includes('hevc,yuv420p') && hevc[0].includes('a-4x9.mp4'));
  const odd = validateCards(show, dir, { probe: (a) => ({ ...okProbe(a), pixFmt: 'yuv444p' }) });
  assert.equal(odd.length, 2);
  assert.ok(odd[0].includes('h264,yuv444p'));
});

test('a bad fallback is reported even when the bespoke card is fine', () => {
  const dir = mkdtempSync(join(tmpdir(), 'show-'));
  mkdirSync(join(dir, 'cards'));
  for (const f of ['bespoke-4x9', 'bespoke-8x9', 'p1-4x9']) writeFileSync(join(dir, 'cards', `${f}.mp4`), 'bytes');
  // p1-8x9 is absent; p1-4x9 will probe as corrupt
  const show = indexShow({ built: 'now', days: {}, players: [{
    id: 'p1', name: 'A',
    cards: { '4x9': 'cards/bespoke-4x9.mp4', '8x9': 'cards/bespoke-8x9.mp4' },
    fallback: { '4x9': 'cards/p1-4x9.mp4', '8x9': 'cards/p1-8x9.mp4' },
  }] });
  const probe = (abs) => { if (abs.includes('p1-4x9')) throw new Error('truncated'); return okProbe(abs); };
  const problems = validateCards(show, dir, { probe });
  assert.equal(problems.length, 2);
  assert.ok(problems.some((p) => p.includes('unreadable') && p.includes('p1-4x9.mp4')));
  assert.ok(problems.some((p) => p.includes('missing') && p.includes('p1-8x9.mp4')));
});

test('without ffprobe the validator says so rather than passing', () => {
  const { dir, show } = oneCardShow();
  const problems = validateCards(show, dir, { probe: () => { throw new ProbeUnavailable('ffprobe was not found on PATH'); } });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /cannot validate cards.*ffprobe/);
});

test('indexShow gives a byId lookup that does not serialise', () => {
  const show = indexShow({ built: 'now', players: [{ id: 'x', name: 'X' }], days: { 1: [], 2: [] } });
  assert.equal(show.byId.x.name, 'X');
  assert.equal('byId' in JSON.parse(JSON.stringify(show)), false);
});

test('buildShow with a stub builder: shapes the days, builds only what is missing, writes the manifest', async () => {
  const f = fixture();
  const built = [];
  const buildCard = async ({ player, format, outPath }) => { built.push(`${player.id}-${format}`); writeFileSync(outPath, 'clip'); return outPath; };
  const outPath = join(f.dir, 'show.json');
  const show = await buildShow({ ...f, flagsDir: f.dir, runningOrderPath: join(f.dir, 'none.json'), outPath, buildCard, probe: okProbe });
  assert.equal(built.length, 104);
  assert.equal(show.players.length, 52);
  assert.equal(show.days[1].length, 13);
  assert.equal(show.days[2].length, 26);
  assert.deepEqual(show.days[1][0].intl, ['player-intl-1', 'player-intl-2']);
  assert.deepEqual(show.days[1][12].intl, ['player-intl-25', 'player-intl-26']);
  assert.deepEqual(show.days[2][25].intl, ['player-intl-26']);
  assert.equal(show.byId['player-usa-3'].generic, true);
  assert.ok(existsSync(outPath));
  const written = JSON.parse(readFileSync(outPath, 'utf8'));
  assert.equal(written.players.length, 52);
  assert.equal('byId' in written, false, 'byId must not be serialised into show.json');
  assert.equal(existsSync(`${outPath}.tmp`), false, 'no temp file left behind');
  // second run: everything exists, nothing is rebuilt
  built.length = 0;
  await buildShow({ ...f, flagsDir: f.dir, runningOrderPath: join(f.dir, 'none.json'), outPath, buildCard, probe: okProbe });
  assert.equal(built.length, 0);
});

test('buildShow refuses to finish, and writes nothing, when a card fails validation', async () => {
  const f = fixture();
  const outPath = join(f.dir, 'show.json');
  const buildCard = async ({ outPath: o }) => { writeFileSync(o, 'clip'); };
  await assert.rejects(
    buildShow({ ...f, flagsDir: f.dir, runningOrderPath: join(f.dir, 'none.json'), outPath, buildCard,
      probe: () => { throw new Error('truncated'); } }),
    (e) => e instanceof BuildError && e.message.includes('not playable') && e.message.includes('truncated'));
  assert.equal(existsSync(outPath), false);
});

test('buildShow propagates a card builder failure', async () => {
  const f = fixture();
  await assert.rejects(buildShow({ ...f, flagsDir: f.dir, outPath: null,
    runningOrderPath: join(f.dir, 'none.json'), buildCard: async () => { throw new Error('ffmpeg exploded'); } }),
  /ffmpeg exploded/);
});

test('manifestOnly builds the Show without generating, validating or writing', async () => {
  const f = fixture();
  const outPath = join(f.dir, 'show.json');
  const show = await buildShow({ ...f, runningOrderPath: join(f.dir, 'none.json'), outPath, manifestOnly: true,
    buildCard: async () => { throw new Error('must not be called'); } });
  assert.equal(show.players.length, 52);
  assert.equal(existsSync(outPath), false);
});

const ro = (f, days1) => {
  const path = join(f.dir, 'ro.json');
  writeFileSync(path, days1 === undefined ? 'null' : JSON.stringify({ days: { 1: days1 } }));
  return path;
};
const manifest = (f, path) => buildShow({ ...f, runningOrderPath: path, manifestOnly: true });

test('a running order naming a USA player or an unknown id is rejected', async () => {
  const f = fixture();
  await assert.rejects(manifest(f, ro(f, [{ index: 1, intl: ['player-intl-1', 'player-usa-1'] }])), /International player ids/);
  await assert.rejects(manifest(f, ro(f, [{ index: 1, intl: ['player-intl-1', 'player-intl-99'] }])), /International player ids/);
});

test('a running order overrides the default Day 1 pairing, defaults fill the rest', async () => {
  const f = fixture();
  const show = await manifest(f, ro(f, [
    { index: 1, intl: ['player-intl-4', 'player-intl-3'] },
    { index: 2, intl: ['player-intl-1', 'player-intl-2'] },
  ]));
  assert.deepEqual(show.days[1][0].intl, ['player-intl-4', 'player-intl-3']);
  assert.deepEqual(show.days[1][1].intl, ['player-intl-1', 'player-intl-2']);
  assert.deepEqual(show.days[1][2].intl, ['player-intl-5', 'player-intl-6']);
  const ids = show.days[1].flatMap((m) => m.intl);
  assert.equal(new Set(ids).size, 26);
});

test('the same player on both sides of one match is rejected, naming the player', async () => {
  const f = fixture();
  await assert.rejects(manifest(f, ro(f, [{ index: 1, intl: ['player-intl-1', 'player-intl-1'] }])),
    (e) => e instanceof BuildError && e.message.includes('player-intl-1') && e.message.includes('match 1'));
});

test('the same player in two matches is rejected, naming both, including via a default pairing', async () => {
  const f = fixture();
  // explicit vs explicit
  await assert.rejects(manifest(f, ro(f, [
    { index: 1, intl: ['player-intl-1', 'player-intl-2'] },
    { index: 2, intl: ['player-intl-2', 'player-intl-3'] },
  ])), (e) => e instanceof BuildError && e.message.includes('player-intl-2 ') && e.message.includes('match 1') && e.message.includes('match 2'));
  // explicit vs the default for match 2 ([3,4])
  await assert.rejects(manifest(f, ro(f, [{ index: 1, intl: ['player-intl-9', 'player-intl-3'] }])),
    (e) => e instanceof BuildError && e.message.includes('player-intl-3') && e.message.includes('match 2'));
});

test('a bad running-order index is an error, not a silent default', async () => {
  const f = fixture();
  const pair = ['player-intl-1', 'player-intl-2'];
  for (const index of [0, 14, '1', 1.5, undefined, null]) {
    await assert.rejects(manifest(f, ro(f, [{ index, intl: pair }])), (e) => e instanceof BuildError && /index/.test(e.message),
      `index ${JSON.stringify(index)} should be rejected`);
  }
  await assert.rejects(manifest(f, ro(f, [{ index: 1, intl: pair }, { index: 1, intl: pair }])),
    (e) => e instanceof BuildError && /appears twice/.test(e.message));
});

test('a null or non-object entry in the running order is a BuildError, not a TypeError', async () => {
  const f = fixture();
  await assert.rejects(manifest(f, ro(f, [null])), (e) => e instanceof BuildError);
  await assert.rejects(manifest(f, ro(f, ['x'])), (e) => e instanceof BuildError);
});

test('cardsDir must be called cards', async () => {
  const f = fixture();
  await assert.rejects(buildShow({ ...f, cardsDir: f.dir, manifestOnly: true }), BuildError);
});

// --- the slideshow of years gone by ------------------------------------------

test('no photo manifest means no photographs, and never an error', () => {
  // The ordinary case for most of the year: build-photos.mjs has not been run,
  // so party/photos/ does not exist. A build must not care.
  const dir = mkdtempSync(join(tmpdir(), 'photos-'));
  assert.deepEqual(loadPhotos(join(dir, 'nothing', 'manifest.json')), []);
  assert.deepEqual(loadPhotos(undefined), []);
  assert.deepEqual(loadPhotos(''), []);
});

test('a manifest that is broken or the wrong shape costs the photographs, not the build', () => {
  const dir = mkdtempSync(join(tmpdir(), 'photos-'));
  const write = (text) => {
    const p = join(dir, 'manifest.json');
    writeFileSync(p, text);
    return p;
  };
  // Half-written (the build ran while build-photos was still going), and every
  // shape that is valid JSON but not a manifest.
  assert.deepEqual(loadPhotos(write('{"photos": [{"src"')), []);
  assert.deepEqual(loadPhotos(write('null')), []);
  assert.deepEqual(loadPhotos(write('[]')), []);
  assert.deepEqual(loadPhotos(write('{"photos": "lots"}')), []);
  assert.deepEqual(loadPhotos(write('{}')), []);
});

test('the manifest keeps its order and drops rows that would show as a gap', () => {
  const dir = mkdtempSync(join(tmpdir(), 'photos-'));
  const p = join(dir, 'manifest.json');
  writeFileSync(p, JSON.stringify({
    built: 'now',
    photos: [
      { key: 'a|1|2', src: 'photos/2021-0001.jpg', year: '2021', w: 1920, h: 1080 },
      { src: '', year: '2021' },
      null,
      { year: '2022' },
      { key: 'b|1|2', src: 'photos/2025-0002.jpg', year: '2025', w: 1440, h: 1920 },
    ],
  }));
  // Only what a screen needs: the build's own bookkeeping (key, w, h) is not
  // carried into the show, which every surface on the venue wifi can read.
  assert.deepEqual(loadPhotos(p), [
    { src: 'photos/2021-0001.jpg', year: '2021' },
    { src: 'photos/2025-0002.jpg', year: '2025' },
  ]);
});

test('a built show carries the photographs it was given', async () => {
  const { detailsPath, cardsDir, cardKeys } = fixture();
  const dir = mkdtempSync(join(tmpdir(), 'photos-'));
  const photosPath = join(dir, 'manifest.json');
  writeFileSync(photosPath, JSON.stringify({ photos: [{ src: 'photos/2023-0001.jpg', year: '2023' }] }));
  const show = await buildShow({ detailsPath, cardsDir, cardKeys, photosPath, manifestOnly: true });
  assert.deepEqual(show.photos, [{ src: 'photos/2023-0001.jpg', year: '2023' }]);
  // And a show built with no photographs still has the key, as an empty list,
  // so no surface has to tell "none" apart from "this show predates photos".
  const none = await buildShow({ detailsPath, cardsDir, cardKeys, photosPath: join(dir, 'gone.json'), manifestOnly: true });
  assert.deepEqual(none.photos, []);
});

