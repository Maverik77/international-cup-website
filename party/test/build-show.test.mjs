import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  validateCards, indexShow, planCards, buildShow, BuildError, ProbeUnavailable,
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
const okProbe = (abs) => ({ width: abs.includes('4x9') ? 480 : 960, height: 1080, duration: 9 });

test('the card-key map has 25 entries and keeps phil and phillip apart', () => {
  assert.equal(Object.keys(CARD_KEYS).length, 25);
  assert.equal(CARD_KEYS['Philip Woodisse'], 'phil');
  assert.equal(CARD_KEYS['Phillip Jewell'], 'phillip');
  assert.equal(new Set(Object.values(CARD_KEYS)).size, 25, 'no two players share a card');
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

test('validation passes good files and shares probes between cards and identical fallbacks', () => {
  const { dir, show } = oneCardShow();
  let calls = 0;
  assert.deepEqual(validateCards(show, dir, { probe: (a) => { calls++; return okProbe(a); } }), []);
  assert.equal(calls, 2);
});

test('validation reports wrong size, bad duration and unreadable files by file and reason', () => {
  const { dir, show } = oneCardShow();
  const wrong = validateCards(show, dir, { probe: () => ({ width: 1920, height: 1080, duration: 9 }) });
  assert.ok(wrong.some((p) => p.includes('a-4x9.mp4') && p.includes('1920x1080')));
  const short = validateCards(show, dir, { probe: (a) => ({ ...okProbe(a), duration: 0.04 }) });
  assert.ok(short.every((p) => p.includes('implausible duration')));
  const bad = validateCards(show, dir, { probe: () => { throw new Error('it has no video stream'); } });
  assert.equal(bad.length, 2);
  assert.ok(bad[0].includes('unreadable') && bad[0].includes('no video stream'));
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
  assert.equal(JSON.parse(readFileSync(outPath, 'utf8')).players.length, 52);
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

test('a running order naming an unknown or USA player is rejected', async () => {
  const f = fixture();
  const ro = join(f.dir, 'ro.json');
  writeFileSync(ro, JSON.stringify({ days: { 1: [{ index: 1, intl: ['player-intl-1', 'player-usa-1'] }] } }));
  await assert.rejects(buildShow({ ...f, runningOrderPath: ro, manifestOnly: true }), /running-order/);
});

test('a running order overrides the default Day 1 pairing', async () => {
  const f = fixture();
  const ro = join(f.dir, 'ro.json');
  writeFileSync(ro, JSON.stringify({ days: { 1: [{ index: 1, intl: ['player-intl-9', 'player-intl-3'] }] } }));
  const show = await buildShow({ ...f, runningOrderPath: ro, manifestOnly: true });
  assert.deepEqual(show.days[1][0].intl, ['player-intl-9', 'player-intl-3']);
  assert.deepEqual(show.days[1][1].intl, ['player-intl-3', 'player-intl-4']);
});

test('cardsDir must be called cards', async () => {
  const f = fixture();
  await assert.rejects(buildShow({ ...f, cardsDir: f.dir, manifestOnly: true }), BuildError);
});
