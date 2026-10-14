import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rehearsalPlan, runRehearsal, startRehearsalHub } from '../rehearse.mjs';
import { createHub } from '../hub.mjs';
import { indexShow } from '../build/build-show.mjs';
import { sessionToken } from '../lib/auth.mjs';

function makeShow() {
  const players = [];
  for (let i = 1; i <= 26; i++) players.push({ id: `player-intl-${i}`, team: 'international', name: `I${i}` });
  for (let i = 1; i <= 26; i++) players.push({ id: `player-usa-${i}`, team: 'usa', name: `U${i}` });
  const day1 = [];
  for (let i = 1; i <= 13; i++) day1.push({ index: i, intl: [`player-intl-${i * 2 - 1}`, `player-intl-${i * 2}`], usa: ['', ''] });
  const day2 = [];
  for (let i = 1; i <= 26; i++) day2.push({ index: i, intl: [`player-intl-${i}`], usa: [''] });
  return indexShow({ built: 'now', players, days: { 1: day1, 2: day2 } });
}
const show = makeShow();

const PASSWORD = 'test-password-1';
const cookie = { Cookie: `icup_op=${sessionToken(PASSWORD)}` };

// A directory shaped like party/, so nothing here can touch the real one.
function fixtureDir() {
  const dir = mkdtempSync(join(tmpdir(), 'rehearse-'));
  mkdirSync(join(dir, 'cards'));
  mkdirSync(join(dir, 'public'));
  mkdirSync(join(dir, 'private'));
  writeFileSync(join(dir, 'public', 'stage.html'), 'x');
  writeFileSync(join(dir, 'private', 'operator.html'), 'x');
  writeFileSync(join(dir, 'private', 'login.html'), 'x');
  writeFileSync(join(dir, 'show.json'), JSON.stringify(show));
  return dir;
}
const hubOptions = (dir) => ({
  showPath: join(dir, 'show.json'), cardsDir: join(dir, 'cards'),
  publicDir: join(dir, 'public'), privateDir: join(dir, 'private'),
  operatorPassword: PASSWORD, operatorPasswordPath: join(dir, 'operator-password.txt'),
  quiet: true,
});

const hubs = [];
after(async () => { for (const h of hubs) { try { await h.stop(); } catch { /* already stopped */ } } });

test('the plan walks both days end to end', () => {
  const plan = rehearsalPlan(show);
  assert.equal(plan[0].name, 'setDay');
  assert.equal(plan[0].day, 1);
  assert.equal(plan.filter((c) => c.name === 'next').length, 39);
  assert.equal(plan.filter((c) => c.name === 'reveal').length, 78);
  assert.ok(plan.some((c) => c.name === 'setDay' && c.day === 2));
  assert.equal(plan.at(-1).name, 'setMode');
  assert.equal(plan.at(-1).mode, 'slideshow');
});

test('both sides get filled, from the right teams', () => {
  const assigns = rehearsalPlan(show).filter((c) => c.name === 'assign');
  assert.equal(assigns.length, 78);
  for (const a of assigns) {
    const want = a.side === 'intl' ? 'international' : 'usa';
    assert.ok(a.players.every((id) => show.byId[id].team === want), `${a.side} got the wrong team`);
  }
});

test('no player is used twice on a day', () => {
  const plan = rehearsalPlan(show);
  let day = 1;
  const used = { 1: new Set(), 2: new Set() };
  for (const c of plan) {
    if (c.name === 'setDay') day = c.day;
    if (c.name !== 'assign') continue;
    for (const id of c.players) {
      assert.equal(used[day].has(id), false, `${id} used twice on day ${day}`);
      used[day].add(id);
    }
  }
});

test('the driver sends every command and reports the count', async () => {
  const sent = [];
  const fetchImpl = async (url, init) => {
    sent.push(JSON.parse(init.body));
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  const plan = [{ name: 'reveal' }, { name: 'next' }];
  const n = await runRehearsal({ baseUrl: 'http://127.0.0.1:1', plan, pace: 0, fetchImpl });
  assert.equal(n, 2);
  assert.deepEqual(sent, plan);
});

test('the driver keeps going when the hub rejects one command', async () => {
  let call = 0;
  const fetchImpl = async () => {
    call += 1;
    return call === 1
      ? { ok: false, status: 400, json: async () => ({ ok: false, error: 'no slot 99' }) }
      : { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  const n = await runRehearsal({
    baseUrl: 'http://127.0.0.1:1', plan: [{ name: 'goto', index: 99 }, { name: 'reveal' }],
    pace: 0, fetchImpl,
  });
  assert.equal(n, 2);
});

test('the driver sends the operator session with every command and reports a refusal', async () => {
  const seen = [];
  const steps = [];
  const fetchImpl = async (url, init) => {
    seen.push(init.headers);
    return { ok: false, status: 401, json: async () => ({ ok: false, needPassword: true, error: 'Enter the password.' }) };
  };
  await runRehearsal({
    baseUrl: 'http://x', plan: [{ name: 'reveal' }], pace: 0, fetchImpl,
    headers: cookie, onStep: (i, total, c, outcome) => steps.push(outcome),
  });
  assert.equal(seen[0].Cookie, cookie.Cookie);
  assert.equal(seen[0]['Content-Type'], 'application/json');
  assert.deepEqual(steps, ['Enter the password.']);
});

test('a rehearsal leaves the live state file alone and never reaches AWS', async () => {
  const dir = fixtureDir();
  let touchedNetwork = false;
  const hub = await createHub({
    ...hubOptions(dir),
    statePath: join(dir, 'state.rehearsal.json'),
    port: 0, enableSync: false, rehearsal: true,
    fetchImpl: async () => { touchedNetwork = true; throw new Error('must not be called'); },
  });
  hubs.push(hub);
  const base = `http://127.0.0.1:${hub.server.address().port}`;
  await runRehearsal({ baseUrl: base, plan: rehearsalPlan(show).slice(0, 6), pace: 0, headers: cookie });
  const state = await (await fetch(`${base}/api/state`)).json();
  assert.equal(state.rehearsal, true);
  assert.equal(touchedNetwork, false, 'rehearsal must not reach AWS');
  assert.equal(existsSync(join(dir, 'state.json')), false, 'rehearsal must not write the live state file');
  assert.equal(existsSync(join(dir, 'state.rehearsal.json')), true);
});

// The two guarantees, observed through the code the script really runs.
test('GUARANTEE: the real rehearsal start-up never touches the live state file', async () => {
  const dir = fixtureDir();
  const live = join(dir, 'state.json');
  writeFileSync(live, '{"sentinel":"the live show, do not touch"}\n');
  const before = { bytes: readFileSync(live), mtime: statSync(live).mtimeMs };
  await new Promise((r) => setTimeout(r, 20)); // so a rewrite would show in the mtime

  const hub = await startRehearsalHub({ argv: ['--port', '0'], dir, hubOptions: hubOptions(dir) });
  hubs.push(hub);
  const base = `http://127.0.0.1:${hub.server.address().port}`;
  try {
    const n = await runRehearsal({ baseUrl: base, plan: rehearsalPlan(show), pace: 0, headers: cookie });
    assert.equal(n, rehearsalPlan(show).length);
  } finally { await hub.stop(); }

  assert.equal(existsSync(live), true, 'the live state file was moved or removed');
  assert.ok(readFileSync(live).equals(before.bytes), 'live state.json bytes changed');
  assert.equal(statSync(live).mtimeMs, before.mtime, 'live state.json was rewritten');
  assert.equal(existsSync(`${live}.tmp`), false);
  assert.equal(existsSync(join(dir, 'state.rehearsal.json')), true, 'the rehearsal should have its own file');
});

test('GUARANTEE: the real rehearsal start-up never reaches AWS, even when sync is asked for', async () => {
  const dir = fixtureDir();
  const calls = [];
  const hub = await startRehearsalHub({
    argv: ['--port', '0'], dir,
    // Hostile on purpose: everything that would normally switch sync on.
    hubOptions: {
      ...hubOptions(dir), enableSync: true, password: 'would-be-admin-password',
      syncMinDelay: 0, rehearsal: false,
      fetchImpl: async (url) => { calls.push(String(url)); throw new Error('rehearsal reached the network'); },
    },
  });
  hubs.push(hub);
  const base = `http://127.0.0.1:${hub.server.address().port}`;
  await runRehearsal({ baseUrl: base, plan: rehearsalPlan(show), pace: 0, headers: cookie });
  await new Promise((r) => setTimeout(r, 150)); // long enough for an outbox flush to fire
  assert.deepEqual(calls, [], 'a rehearsal made a network call');
  const state = await (await fetch(`${base}/api/state`)).json();
  assert.equal(state.rehearsal, true);
  assert.equal(state.completed.length, 39);
  const who = await (await fetch(`${base}/api/whoami`, { headers: cookie })).json();
  assert.equal(who.sync, 'off');
});

test('a whole rehearsal completes all 39 matches through the password gate', async () => {
  const dir = fixtureDir();
  const hub = await startRehearsalHub({ argv: ['--port', '0'], dir, hubOptions: hubOptions(dir) });
  hubs.push(hub);
  const base = `http://127.0.0.1:${hub.server.address().port}`;
  const outcomes = [];
  await runRehearsal({
    baseUrl: base, plan: rehearsalPlan(show), pace: 0, headers: cookie,
    onStep: (i, t, c, o) => outcomes.push(o),
  });
  assert.deepEqual(outcomes.filter((o) => o !== 'ok'), []);
  const state = await (await fetch(`${base}/api/state`)).json();
  assert.equal(state.completed.length, 39);
  assert.equal(state.mode, 'slideshow');
});

test('without the session, the gate turns the rehearsal away', async () => {
  const dir = fixtureDir();
  const hub = await startRehearsalHub({ argv: ['--port', '0'], dir, hubOptions: hubOptions(dir) });
  hubs.push(hub);
  const base = `http://127.0.0.1:${hub.server.address().port}`;
  const outcomes = [];
  await runRehearsal({ baseUrl: base, plan: [{ name: 'reveal' }], pace: 0, onStep: (i, t, c, o) => outcomes.push(o) });
  assert.notEqual(outcomes[0], 'ok');
});

test('a second rehearsal starts from match 1, not where the last one ended', async () => {
  const dir = fixtureDir();
  const first = await startRehearsalHub({ argv: ['--port', '0'], dir, hubOptions: hubOptions(dir) });
  const b1 = `http://127.0.0.1:${first.server.address().port}`;
  await runRehearsal({ baseUrl: b1, plan: rehearsalPlan(show), pace: 0, headers: cookie });
  await first.stop();
  const second = await startRehearsalHub({ argv: ['--port', '0'], dir, hubOptions: hubOptions(dir) });
  hubs.push(second);
  const b2 = `http://127.0.0.1:${second.server.address().port}`;
  const state = await (await fetch(`${b2}/api/state`)).json();
  assert.equal(state.completed.length, 0);
});
