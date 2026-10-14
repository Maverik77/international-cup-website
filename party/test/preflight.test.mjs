import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toPlayerItems, rosterDiff, runPush } from '../build/push-roster.mjs';
import { preflightChecks, summarise } from '../build/preflight.mjs';
import { loadRoster } from '../build/roster.mjs';

test('player items match the live table shape', () => {
  const items = toPlayerItems([
    { id: 'player-usa-1', team: 'usa', name: 'John Altman' },
    { id: 'player-intl-14', team: 'international', name: 'Yun Sang Bae' },
  ]);
  assert.deepEqual(items[0], {
    id: 'player-usa-1', team: 'USA', firstName: 'John', lastName: 'Altman',
    nickname: '', teeColor: 'Blue',
  });
  assert.deepEqual(items[1], {
    id: 'player-intl-14', team: 'International', firstName: 'Yun Sang', lastName: 'Bae',
    nickname: '', teeColor: 'Blue',
  });
});

test('the real roster makes 52 items with unique ids', () => {
  const items = toPlayerItems(loadRoster(resolve(dirname(fileURLToPath(import.meta.url)), '../../contacts/player-details.json')));
  assert.equal(items.length, 52);
  assert.equal(new Set(items.map((i) => i.id)).size, 52);
  assert.equal(items.filter((i) => i.team === 'USA').length, 26);
});

test('the diff names who goes and who arrives', () => {
  const existing = [
    { id: 'player-usa-1', firstName: 'John', lastName: 'Altman' },
    { id: 'player-usa-4', firstName: 'Norm', lastName: 'Corkhill' },
  ];
  const incoming = [
    { id: 'player-usa-1', firstName: 'John', lastName: 'Altman' },
    { id: 'player-usa-2', firstName: 'Frank', lastName: 'Ambrose' },
  ];
  const d = rosterDiff(existing, incoming);
  assert.deepEqual(d.added.map((p) => p.lastName), ['Ambrose']);
  assert.deepEqual(d.removed.map((p) => p.lastName), ['Corkhill']);
  assert.deepEqual(d.changed, []);
});

test('a renamed id shows as changed, not as added and removed', () => {
  const d = rosterDiff(
    [{ id: 'player-intl-15', firstName: 'Yunsang', lastName: 'Bae' }],
    [{ id: 'player-intl-15', firstName: 'Yun Sang', lastName: 'Bae' }],
  );
  assert.equal(d.changed.length, 1);
  assert.equal(d.added.length, 0);
  assert.equal(d.removed.length, 0);
});

test('preflight reports a missing show.json rather than throwing', async () => {
  const checks = await preflightChecks({ partyDir: '/nowhere', apiUrl: null });
  const manifest = checks.find((c) => c.name === 'show.json');
  assert.equal(manifest.ok, false);
  assert.match(manifest.detail, /party:build/);
});

test('preflight reports AWS reachability without ever printing the password', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ pairings: [] }) });
  const checks = await preflightChecks({ partyDir: '/nowhere', apiUrl: 'https://api.example/prod', fetchImpl });
  const aws = checks.find((c) => c.name === 'AWS reachable');
  assert.equal(aws.ok, true);
  assert.equal(JSON.stringify(checks).includes('password'), false);
});

test('preflight reports AWS being down as a failed check, not an exception', async () => {
  const fetchImpl = async () => { throw new Error('ENOTFOUND api.example'); };
  const checks = await preflightChecks({ partyDir: '/nowhere', apiUrl: 'https://api.example/prod', fetchImpl });
  assert.equal(checks.find((c) => c.name === 'AWS reachable').ok, false);
});

// ---- the roster push: the confirmation gate -------------------------------

const SYNTH = [
  { id: 'player-intl-1', team: 'international', name: 'Ann Alpha' },
  { id: 'player-usa-1', team: 'usa', name: 'Bob Beta' },
];
const STALE = [
  { id: 'player-usa-1', team: 'USA', firstName: 'Bob', lastName: 'Beta' },
  { id: 'player-usa-9', team: 'USA', firstName: 'Old', lastName: 'Timer' },
];

// A fetch that serves GET /players and records every call. Anything that is
// not a GET is a write.
function recorder(players = STALE) {
  const calls = [];
  let current = players;
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', body: init.body });
    if (init.method === 'POST') current = JSON.parse(init.body).players;
    return { ok: true, status: 200, json: async () => ({ players: current }) };
  };
  const writes = () => calls.filter((c) => c.method !== 'GET');
  return { fetchImpl, calls, writes };
}

function push(argv, { typed = '', players, roster = SYNTH } = {}) {
  const rec = recorder(players);
  const lines = [];
  let asked = 0;
  return runPush({
    argv, roster, fetchImpl: rec.fetchImpl,
    ask: async () => { asked++; return typed; },
    getPassword: () => 'test-secret',
    out: (s) => lines.push(s),
  }).then((code) => ({ code, asked, lines: lines.join('\n'), ...rec }));
}

test('without --confirm the diff is shown and no write is made', async () => {
  const r = await push(['--target', 'staging'], { typed: 'REPLACE-ROSTER-STAGING' });
  assert.equal(r.code, 0);
  assert.equal(r.writes().length, 0);
  assert.equal(r.asked, 0, 'must not even ask for the phrase');
  assert.match(r.lines, /REMOVE/);
  assert.match(r.lines, /ADD/);
  assert.match(r.lines, /Dry run/);
});

test('with --confirm but a wrong phrase no write is made', async () => {
  for (const typed of ['', 'yes', 'replace-roster-staging!', 'REPLACE-ROSTER-PROD']) {
    const r = await push(['--confirm'], { typed });
    assert.equal(r.code, 1, `phrase "${typed}"`);
    assert.equal(r.writes().length, 0, `phrase "${typed}"`);
    assert.match(r.lines, /Nothing was written/);
  }
});

test('the phrase for prod does not unlock staging, nor the reverse', async () => {
  const r = await push(['--target', 'prod', '--confirm'], { typed: 'REPLACE-ROSTER-STAGING' });
  assert.equal(r.asked, 1, 'must have reached the prompt');
  assert.equal(r.code, 1);
  assert.equal(r.writes().length, 0);
  const r2 = await push(['--target', 'staging', '--confirm'], { typed: 'REPLACE-ROSTER-PROD' });
  assert.equal(r2.asked, 1);
  assert.equal(r2.code, 1);
  assert.equal(r2.writes().length, 0);
});

test('with --confirm and the right phrase exactly one write is made, to the chosen target', async () => {
  const r = await push(['--confirm'], { typed: 'REPLACE-ROSTER-STAGING' });
  assert.equal(r.code, 0);
  assert.equal(r.writes().length, 1);
  const w = r.writes()[0];
  assert.equal(w.method, 'POST');
  assert.match(w.url, /9iz68mvngi.*\/players$/);
  assert.deepEqual(JSON.parse(w.body).players.map((p) => p.id), ['player-intl-1', 'player-usa-1']);
});

test('staging is the default target, and an unknown target reaches nothing', async () => {
  const r = await push([]);
  assert.match(r.calls[0].url, /9iz68mvngi/);
  const bad = await push(['--target', 'prd', '--confirm'], { typed: 'x' });
  assert.equal(bad.code, 1);
  assert.equal(bad.calls.length, 0);
  assert.match(bad.lines, /staging/);
});

test('a roster that already matches is left alone even with --confirm', async () => {
  const r = await push(['--confirm'], { typed: 'REPLACE-ROSTER-STAGING', players: toPlayerItems(SYNTH) });
  assert.equal(r.code, 0);
  assert.equal(r.writes().length, 0);
  assert.equal(r.asked, 0);
  assert.match(r.lines, /no change/);
});

test('the push never prints the password it is given', async () => {
  const r = await push(['--confirm'], { typed: 'REPLACE-ROSTER-STAGING' });
  assert.equal(r.lines.includes('test-secret'), false);
});

// ---- the preflight, in a scratch directory --------------------------------

function scratch({ show = true, operator = 'amber-otter-1234\n', pages = true, players = SYNTH } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'preflight-'));
  if (show) {
    writeFileSync(join(dir, 'show.json'), JSON.stringify({
      built: 'then',
      players: players.map((p) => ({ ...p, cards: { '4x9': `cards/${p.id}-4x9.mp4`, '8x9': `cards/${p.id}-8x9.mp4` } })),
      days: { 1: Array(13).fill({}), 2: Array(26).fill({}) },
    }));
  }
  if (show) {
    mkdirSync(join(dir, 'cards'));
    for (const p of players) for (const f of ['4x9', '8x9']) writeFileSync(join(dir, 'cards', `${p.id}-${f}.mp4`), 'x');
  }
  if (operator !== null) writeFileSync(join(dir, 'operator-password.txt'), operator);
  if (pages) {
    mkdirSync(join(dir, 'private'));
    writeFileSync(join(dir, 'private', 'operator.html'), '<p>');
    writeFileSync(join(dir, 'private', 'login.html'), '<p>');
  }
  return dir;
}

const LAN = { en0: [{ family: 'IPv4', internal: false, address: '192.168.1.5' }] };
const live = (players) => async (url) => ({
  ok: true, status: 200,
  json: async () => (String(url).endsWith('/players') ? { players } : { pairings: [] }),
});
const run = (dir, over = {}) => preflightChecks({
  partyDir: dir, apiUrl: 'https://api.example/prod', interfaces: LAN,
  hostRunner: () => ({ status: 0, stdout: 'TestMac\n' }),
  probe: (abs) => (abs.includes('4x9')
    ? { codec: 'h264', pixFmt: 'yuv420p', width: 480, height: 1080, duration: 8 }
    : { codec: 'h264', pixFmt: 'yuv420p', width: 960, height: 1080, duration: 8 }),
  fetchImpl: live(toPlayerItems(SYNTH)), ...over,
});
const by = (checks, name) => checks.find((c) => c.name === name);

test('a roster that matches the show passes the roster check', async () => {
  const dir = scratch();
  try {
    assert.equal(by(await run(dir), 'roster').ok, true);
  } finally { rmSync(dir, { recursive: true }); }
});

test('last year\'s roster fails the roster check and says what to do, without a diff dump', async () => {
  const dir = scratch();
  try {
    const c = by(await run(dir, { fetchImpl: live(STALE) }), 'roster');
    assert.equal(c.ok, false);
    assert.match(c.detail, /does not match this show/);
    assert.match(c.detail, /party:push-roster/);
    assert.equal(c.detail.includes('\n'), false);
    assert.equal(c.detail.includes('Timer'), false);
  } finally { rmSync(dir, { recursive: true }); }
});

test('a renamed player fails the roster check too', async () => {
  const dir = scratch();
  try {
    const renamed = toPlayerItems(SYNTH).map((p) => (p.id === 'player-usa-1' ? { ...p, firstName: 'Robert' } : p));
    assert.equal(by(await run(dir, { fetchImpl: live(renamed) }), 'roster').ok, false);
  } finally { rmSync(dir, { recursive: true }); }
});

test('an unreadable website roster fails the roster check', async () => {
  const dir = scratch();
  try {
    const fetchImpl = async (url) => {
      if (String(url).endsWith('/players')) throw new Error('boom');
      return { ok: true, status: 200, json: async () => ({ pairings: [] }) };
    };
    assert.equal(by(await run(dir, { fetchImpl }), 'roster').ok, false);
  } finally { rmSync(dir, { recursive: true }); }
});

test('the night\'s furniture is checked: operator login, pages, LAN', async () => {
  const dir = scratch();
  try {
    const checks = await run(dir);
    for (const n of ['operator login', 'operator pages', 'LAN address']) assert.equal(by(checks, n).ok, true, n);
    assert.match(by(checks, 'LAN address').detail, /192\.168\.1\.5/);
  } finally { rmSync(dir, { recursive: true }); }
});

test('a missing or blank operator file fails, and the preflight does not create it', async () => {
  for (const operator of [null, '  \n']) {
    const dir = scratch({ operator });
    try {
      const c = by(await run(dir), 'operator login');
      assert.equal(c.ok, false);
      assert.match(c.detail, /party:start/);
      const again = by(await run(dir), 'operator login');
      assert.equal(again.ok, false, 'the first run must not have written the file');
    } finally { rmSync(dir, { recursive: true }); }
  }
});

test('the operator secret is never in the output', async () => {
  const dir = scratch({ operator: 'amber-otter-1234\n' });
  try {
    const text = JSON.stringify(await run(dir)) + summarise(await run(dir)).join('\n');
    assert.equal(text.includes('amber-otter-1234'), false);
  } finally { rmSync(dir, { recursive: true }); }
});

test('missing console pages fail, naming the file', async () => {
  const dir = scratch({ pages: false });
  try {
    const c = by(await run(dir), 'operator pages');
    assert.equal(c.ok, false);
    assert.match(c.detail, /operator\.html/);
  } finally { rmSync(dir, { recursive: true }); }
});

test('no LAN address fails the LAN check', async () => {
  const dir = scratch();
  try {
    assert.equal(by(await run(dir, { interfaces: {} }), 'LAN address').ok, false);
  } finally { rmSync(dir, { recursive: true }); }
});

test('preflight writes nothing to the website', async () => {
  const dir = scratch();
  try {
    const calls = [];
    const inner = live(toPlayerItems(SYNTH));
    await run(dir, { fetchImpl: async (u, i = {}) => { calls.push(i.method || 'GET'); return inner(u, i); } });
    assert.ok(calls.length > 0);
    assert.deepEqual([...new Set(calls)], ['GET']);
  } finally { rmSync(dir, { recursive: true }); }
});

test('every check is one line, and the verdict says plainly whether the night is ready', async () => {
  const dir = scratch();
  try {
    const good = summarise(await run(dir));
    assert.match(good.at(-1), /READY/);
    assert.doesNotMatch(good.at(-1), /NOT READY/);
    const bad = summarise(await run(dir, { fetchImpl: live(STALE) }));
    assert.match(bad.at(-1), /NOT READY/);
    assert.ok(bad.some((l) => l.startsWith('[!!]')));
    for (const l of bad) assert.equal(l.includes('\n'), false);
  } finally { rmSync(dir, { recursive: true }); }
});

// ---- fix round 1 -----------------------------------------------------------

test('the cards check really examines the cards (so READY means something)', async () => {
  const dir = scratch();
  try {
    assert.equal(by(await run(dir), 'cards').ok, true);
    // A file that is the wrong shape must fail it: proves the fixture is looked at.
    const c = by(await run(dir, { probe: () => ({ codec: 'vp9', pixFmt: 'yuv420p', width: 1, height: 1, duration: 8 }) }), 'cards');
    assert.equal(c.ok, false);
  } finally { rmSync(dir, { recursive: true }); }
});

test('a show.json with no running order is a failed check, never a thrown error', async () => {
  const dir = scratch();
  try {
    writeFileSync(join(dir, 'show.json'), JSON.stringify({ players: [{ id: 'player-usa-1', team: 'usa', name: 'Bob Beta' }] }));
    const checks = await run(dir);
    const c = by(checks, 'running order');
    assert.equal(c.ok, false);
    assert.match(c.detail, /party:build/);
    assert.match(summarise(checks).at(-1), /NOT READY/);
  } finally { rmSync(dir, { recursive: true }); }
});

test('a show.json that is not even a show is a failed check, never a thrown error', async () => {
  const dir = scratch();
  try {
    for (const body of ['{}', '[]', 'null', '{"players":[null]}']) {
      writeFileSync(join(dir, 'show.json'), body);
      const checks = await run(dir);
      assert.equal(checks.some((c) => !c.ok), true, body);
      for (const c of checks) assert.doesNotMatch(c.detail, /undefined|TypeError|Cannot read/, body);
    }
  } finally { rmSync(dir, { recursive: true }); }
});

test('a player with no name in show.json blames show.json, not the website', async () => {
  const dir = scratch();
  try {
    writeFileSync(join(dir, 'show.json'), JSON.stringify({
      built: 'x', players: [{ id: 'player-usa-1', team: 'usa' }], days: { 1: Array(13).fill({}), 2: Array(26).fill({}) },
    }));
    const c = by(await run(dir), 'roster');
    assert.equal(c.ok, false);
    assert.match(c.detail, /show\.json/);
    assert.doesNotMatch(c.detail, /website's roster/);
    assert.doesNotMatch(c.detail, /Cannot read/);
  } finally { rmSync(dir, { recursive: true }); }
});

test('the roster advice names the table that was checked', async () => {
  const dir = scratch();
  try {
    for (const target of ['staging', 'prod']) {
      const c = by(await run(dir, { fetchImpl: live(STALE), target }), 'roster');
      assert.match(c.detail, new RegExp(`--target ${target}\\b`));
      assert.equal(c.detail.includes(target === 'staging' ? '--target prod' : '--target staging'), false);
    }
  } finally { rmSync(dir, { recursive: true }); }
});

test('the command line names the table in a header and follows --target', async () => {
  const { spawnSync } = await import('node:child_process');
  const script = resolve(dirname(fileURLToPath(import.meta.url)), '../build/preflight.mjs');
  const r = spawnSync(process.execPath, [script, '--target', 'nonsense'], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /not a target/);
  assert.equal(r.stdout.includes('at file:'), false);
});

test('no Bonjour name is advisory when there is an IP address, fatal for nothing else', async () => {
  const dir = scratch();
  try {
    const c = by(await run(dir, { hostRunner: () => ({ status: 1, stdout: '' }) }), 'Bonjour name');
    assert.equal(c.ok, true);
    assert.match(c.detail, /IP address/);
    assert.equal(by(await run(dir, { hostRunner: () => ({ status: 1, stdout: '' }), interfaces: {} }), 'Bonjour name').ok, false);
  } finally { rmSync(dir, { recursive: true }); }
});

test('the diff sees a wrong team on the right id', () => {
  const d = rosterDiff(
    [{ id: 'player-usa-1', team: 'International', firstName: 'Bob', lastName: 'Beta', teeColor: 'Blue' }],
    [{ id: 'player-usa-1', team: 'USA', firstName: 'Bob', lastName: 'Beta', teeColor: 'Blue' }],
  );
  assert.equal(d.changed.length, 1);
  assert.match(d.changed[0].was, /International/);
  assert.match(d.changed[0].now, /USA/);
});

test('a push that lands completely says all present', async () => {
  const rec = recorder(STALE);
  const lines = [];
  const code = await runPush({
    argv: ['--confirm'], roster: SYNTH, ask: async () => 'REPLACE-ROSTER-STAGING',
    getPassword: () => 'test-secret', out: (s) => lines.push(s),
    fetchImpl: async (url, init = {}) => {
      rec.calls.push({ method: init.method || 'GET' });
      if (init.method === 'POST') return { ok: true, status: 200, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ players: rec.calls.filter((c) => c.method === 'POST').length ? toPlayerItems(SYNTH) : STALE }) };
    },
  });
  assert.equal(code, 0);
  assert.match(lines.join('\n'), /\[ok\] all 2 present/);
});

test('a push that drops players says how many and that running again is safe, and fails', async () => {
  const lines = [];
  let wrote = false;
  const code = await runPush({
    argv: ['--confirm'], roster: SYNTH, ask: async () => 'REPLACE-ROSTER-STAGING',
    getPassword: () => 'test-secret', out: (s) => lines.push(s),
    fetchImpl: async (url, init = {}) => {
      if (init.method === 'POST') { wrote = true; return { ok: true, status: 200, json: async () => ({}) }; }
      // After the write, the table is one short: the Lambda dropped a slice.
      return { ok: true, status: 200, json: async () => ({ players: wrote ? toPlayerItems(SYNTH).slice(0, 1) : STALE }) };
    },
  });
  const text = lines.join('\n');
  assert.equal(code, 1);
  assert.match(text, /\[!!\] 1 of 2 - run it again/);
  assert.match(text, /safe/);
  assert.doesNotMatch(text, /all 2 present/);
});

test('a write that errors is not reported as "nothing was written"', async () => {
  const lines = [];
  const code = await runPush({
    argv: ['--confirm'], roster: SYNTH, ask: async () => 'REPLACE-ROSTER-STAGING',
    getPassword: () => 'test-secret', out: (s) => lines.push(s),
    fetchImpl: async (url, init = {}) => (init.method === 'POST'
      ? { ok: false, status: 502, json: async () => ({}) }
      : { ok: true, status: 200, json: async () => ({ players: STALE }) }),
  });
  const text = lines.join('\n');
  assert.equal(code, 1);
  assert.match(text, /may not have finished/);
  assert.match(text, /safe/);
  assert.equal(text.includes('test-secret'), false);
});
