import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { connect } from 'node:net';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync, symlinkSync, copyFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { MAX_SCREENS, SCREEN_ROLES } from "../public/panels.mjs";
import { SCREEN_ROLE_LABELS } from '../public/console.mjs';
import { createHub, parseArgs, MAX_BODY_BYTES, STOP_FLUSH_MS, shutdownLines } from '../hub.mjs';
import { sessionToken } from '../lib/auth.mjs';
import { CommandError, reduce } from '../lib/state.mjs';

const REAL_LOGIN = join(fileURLToPath(new URL('../private', import.meta.url)), 'login.html');

function fixtureShow(dir, tweak) {
  const players = [];
  for (let i = 1; i <= 26; i++) players.push({ id: `player-intl-${i}`, team: 'international', name: `I${i}`, country: 'India', hometown: '', school: '', generic: true, cards: { '4x9': `cards/i${i}-4x9.mp4`, '8x9': `cards/i${i}-8x9.mp4` }, fallback: { '4x9': `cards/i${i}-4x9.mp4`, '8x9': `cards/i${i}-8x9.mp4` } });
  for (let i = 1; i <= 26; i++) players.push({ id: `player-usa-${i}`, team: 'usa', name: `U${i}`, country: 'USA', hometown: '', school: '', generic: true, cards: { '4x9': `cards/u${i}-4x9.mp4`, '8x9': `cards/u${i}-8x9.mp4` }, fallback: { '4x9': `cards/u${i}-4x9.mp4`, '8x9': `cards/u${i}-8x9.mp4` } });
  const day1 = [];
  for (let i = 1; i <= 13; i++) day1.push({ index: i, intl: [`player-intl-${i * 2 - 1}`, `player-intl-${i * 2}`], usa: ['', ''] });
  const day2 = [];
  for (let i = 1; i <= 26; i++) day2.push({ index: i, intl: [`player-intl-${i}`], usa: [''] });
  const showPath = join(dir, 'show.json');
  const show = { built: 'now', players, days: { 1: day1, 2: day2 } };
  if (tweak) tweak(show);
  writeFileSync(showPath, JSON.stringify(show));
  return showPath;
}

const hubs = [];
async function startHub(opts = {}) {
  const dir = opts.dir || mkdtempSync(join(tmpdir(), 'hub-'));
  const cardsDir = join(dir, 'cards');
  mkdirSync(cardsDir, { recursive: true });
  writeFileSync(join(cardsDir, 'i1-4x9.mp4'), Buffer.from('videobytes'));
  const publicDir = join(dir, 'public');
  mkdirSync(publicDir, { recursive: true });
  writeFileSync(join(publicDir, 'stage.html'), '<h1>stage</h1>');
  const privateDir = join(dir, 'private');
  mkdirSync(privateDir, { recursive: true });
  writeFileSync(join(privateDir, 'operator.html'), '<h1>operator</h1>');
  copyFileSync(REAL_LOGIN, join(privateDir, 'login.html')); // the real page: test 13 pins its Unlock button
  const { dir: _d, showTweak, ...rest } = opts;
  const hub = await createHub({
    showPath: fixtureShow(dir, showTweak),
    statePath: join(dir, 'state.json'),
    cardsDir, publicDir, privateDir, port: 0, enableSync: false, quiet: true,
    // A known password, and a path in the temp dir: never write into the real party/.
    operatorPassword: 'test-password-1',
    operatorPasswordPath: join(dir, 'operator-password.txt'),
    ...rest,
  });
  hubs.push(hub);
  const port = hub.server.address().port;
  return { hub, dir, port, base: `http://127.0.0.1:${port}` };
}

// Whatever a test leaves running is closed here so a failure cannot hang the suite.
import { after } from 'node:test';
after(async () => { for (const h of hubs) { try { await h.stop(); } catch { /* already stopped */ } } });

export const opCookie = (password = 'test-password-1') => ({ Cookie: `icup_op=${sessionToken(password)}` });

const postNoAuth = (base, body, headers = { 'Content-Type': 'application/json' }) =>
  fetch(`${base}/api/command`, { method: 'POST', headers, body: typeof body === 'string' || body === undefined ? body : JSON.stringify(body) });

// Signed in by default. A caller's headers win, so tests can still send the wrong
// content-type or a foreign Origin.
const post = (base, body, headers = { 'Content-Type': 'application/json' }) =>
  postNoAuth(base, body, { ...opCookie(), ...headers });

const login = (base, password, headers = { 'Content-Type': 'application/json' }) =>
  fetch(`${base}/api/login`, { method: 'POST', headers, body: typeof password === 'string' && headers['Content-Type'] !== 'application/json' ? password : JSON.stringify({ password }) });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 2000) {
  const t = Date.now();
  while (Date.now() - t < ms) { if (await fn()) return true; await wait(10); }
  return false;
}

// A raw SSE client over a bare socket, so a test can vanish without a goodbye.
function sseClient(port) {
  const sock = connect(port, '127.0.0.1');
  let buffer = '';
  const frames = [];
  sock.on('data', (c) => {
    buffer += c.toString('utf8');
    for (;;) {
      const m = /event: (\w+)\ndata: (.*)\n\n/.exec(buffer);
      if (!m) break;
      frames.push({ event: m[1], data: JSON.parse(m[2]) });
      buffer = buffer.slice(m.index + m[0].length);
    }
  });
  sock.on('error', () => {});
  sock.write(`GET /events HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n\r\n`);
  return { sock, frames, kill: () => sock.destroy() };
}

test('serves the show and the initial state', async () => {
  const { base } = await startHub();
  const show = await (await fetch(`${base}/api/show`)).json();
  assert.equal(show.players.length, 52);
  const state = await (await fetch(`${base}/api/state`)).json();
  assert.equal(state.day, 1);
  assert.equal(state.slot.index, 1);
  assert.equal(state.slot.shown, 'none');
});

test('/api/show never carries hometown or school, for any player, anywhere in the body', async () => {
  // Give every player private details on disk, as the real show.json has.
  const again = await startHub({ showTweak: (show) => show.players.forEach((p, i) => { p.hometown = `PRIVATE-TOWN-${i}`; p.school = `PRIVATE-SCHOOL-${i}`; }) });
  const path = join(again.dir, 'show.json');
  const text = await (await fetch(`${again.base}/api/show`)).text();
  assert.doesNotMatch(text, /hometown|school|PRIVATE-/);
  const show = JSON.parse(text);
  assert.equal(show.players.length, 52);
  for (const p of show.players) {
    assert.ok(!('hometown' in p) && !('school' in p));
    for (const k of ['id', 'name', 'team', 'country', 'cards', 'fallback', 'generic']) assert.ok(k in p, `${k} still served`);
  }
  assert.equal(show.days['1'].length, 13);
  // and nothing else endpoint-wise carries them
  for (const path2 of ['/api/state', '/api/whoami']) assert.doesNotMatch(await (await fetch(`${again.base}${path2}`)).text(), /PRIVATE-/);
  assert.match(readFileSync(path, 'utf8'), /PRIVATE-TOWN-0/, 'show.json on disk is untouched');
});

test('the show is indexed at startup, so a command works on a show loaded from JSON', async () => {
  // byId is non-enumerable and does not survive JSON.parse. If the hub forgot to
  // index, reduce() would throw a plain Error here and this would be a 500.
  const { base } = await startHub();
  const res = await post(base, { name: 'assign', side: 'usa', players: ['player-usa-1', 'player-usa-2'] });
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).state.slot.usa, ['player-usa-1', 'player-usa-2']);
});

test('serves the surfaces', async () => {
  const { base } = await startHub();
  assert.match(await (await fetch(`${base}/stage`)).text(), /stage/);
  assert.match(await (await fetch(`${base}/operator`, { headers: opCookie() })).text(), /operator/);
  const landing = await fetch(`${base}/`);
  assert.equal(landing.status, 200);
  assert.match(await landing.text(), /<svg /);
});

test('serves cards with range support', async () => {
  const { base } = await startHub();
  const res = await fetch(`${base}/cards/i1-4x9.mp4`, { headers: { Range: 'bytes=0-4' } });
  assert.equal(res.status, 206);
  assert.equal(res.headers.get('content-range'), 'bytes 0-4/10');
  assert.equal(await res.text(), 'video');
  assert.equal((await fetch(`${base}/cards/nope.mp4`)).status, 404);
});

test('a command changes the state and persists it', async () => {
  const { base, dir } = await startHub();
  const res = await post(base, { name: 'reveal' });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).state.slot.shown, 'first');
  assert.ok(existsSync(join(dir, 'state.json')));
  assert.equal(JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')).slots['1'][0].shown, 'first');
});

test('a bad command is a 400 with a sentence, and changes nothing', async () => {
  const { base } = await startHub();
  const res = await post(base, { name: 'goto', index: 99 });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.match(body.error, /no match 100/i);
  assert.equal((await (await fetch(`${base}/api/state`)).json()).slot.index, 1);
});

test('an unknown command and an empty command are 400s, not faults', async () => {
  const { base } = await startHub();
  assert.equal((await post(base, { name: 'selfDestruct' })).status, 400);
  assert.equal((await post(base, {})).status, 400);
  assert.equal((await post(base, 'null')).status, 400);
  assert.equal((await post(base, '[1,2]')).status, 400);
  assert.equal((await post(base, '42')).status, 400);
});

test('a CommandError is 4xx but any other error is a 500 and is not dressed up as operator input', async () => {
  const seen = [];
  const reduceImpl = (state, command) => {
    seen.push(command.name);
    if (command.name === 'operatorMistake') throw new CommandError('Pick a match from 1 to 13.');
    throw new TypeError('secret internals: cannot read properties of undefined');
  };
  const { base } = await startHub({ reduceImpl });
  const bad = await post(base, { name: 'operatorMistake' });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error, 'Pick a match from 1 to 13.');
  const fault = await post(base, { name: 'anything' });
  assert.equal(fault.status, 500);
  const text = JSON.stringify(await fault.json());
  assert.doesNotMatch(text, /secret internals|TypeError/, 'internals stay in the terminal');
  // and the hub is still alive afterwards
  assert.equal((await fetch(`${base}/api/state`)).status, 200);
});

test('SSE delivers the state on connect and on every change', async () => {
  const { base } = await startHub();
  const res = await fetch(`${base}/events`);
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const nextState = async () => {
    for (;;) {
      const m = /event: state\ndata: (.*)\n\n/.exec(buffer);
      if (m) { buffer = buffer.slice(m.index + m[0].length); return JSON.parse(m[1]); }
      const { value, done } = await reader.read();
      if (done) throw new Error('stream ended');
      buffer += decoder.decode(value, { stream: true });
    }
  };
  assert.equal((await nextState()).slot.shown, 'none');
  await post(base, { name: 'reveal' });
  assert.equal((await nextState()).slot.shown, 'first');
  await reader.cancel();
});

test('two clients at once both receive a broadcast', async () => {
  const { base, port } = await startHub();
  const a = sseClient(port);
  const b = sseClient(port);
  assert.ok(await until(() => a.frames.length >= 1 && b.frames.length >= 1), 'both get the on-connect state');
  await post(base, { name: 'reveal' });
  assert.ok(await until(() => a.frames.length >= 2 && b.frames.length >= 2), 'both get the change');
  assert.equal(a.frames[1].data.slot.shown, 'first');
  assert.equal(b.frames[1].data.slot.shown, 'first');
  a.kill(); b.kill();
});

test('a client that disconnects mid-stream is dropped, and the others carry on', async () => {
  const { hub, base, port } = await startHub();
  const a = sseClient(port);
  const b = sseClient(port);
  assert.ok(await until(() => hub.whoami().clients === 2));
  a.kill();
  assert.ok(await until(() => hub.whoami().clients === 1), 'the dead client is removed');
  const res = await post(base, { name: 'reveal' });
  assert.equal(res.status, 200, 'a dead client cannot fail a command');
  assert.ok(await until(() => b.frames.length >= 2));
  b.kill();
  assert.ok(await until(() => hub.whoami().clients === 0));
});

test('a client that connects and vanishes in the same breath leaks nothing', async () => {
  const { hub, port } = await startHub();
  for (let i = 0; i < 20; i++) sseClient(port).kill();
  assert.ok(await until(() => hub.whoami().clients === 0));
});

test('whoami reports where the console lives', async () => {
  const { base } = await startHub();
  const who = await (await fetch(`${base}/api/whoami`, { headers: opCookie() })).json();
  assert.equal(typeof who.port, 'number');
  assert.ok('operatorUrl' in who);
  assert.ok('mdnsUrl' in who);
  assert.equal(who.recovered, false);
  assert.equal(who.sync, 'off');
});

test('a recovered state file is reported to the console with its reason', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hub-'));
  writeFileSync(join(dir, 'state.json'), '{"version":1,"day":'); // cut off mid-save
  const { base } = await startHub({ dir });
  const who = await (await fetch(`${base}/api/whoami`, { headers: opCookie() })).json();
  assert.equal(who.recovered, true);
  assert.match(who.recoveredReason, /unusable|bad JSON/i);
  assert.ok(who.recoveredSummary && !who.recoveredSummary.includes('.corrupt-'), 'whoami carries the iPad summary, without the file path');
  assert.ok(readdirSync(dir).some((f) => f.startsWith('state.json.corrupt-')), 'the bad file was kept as evidence');
  assert.equal((await (await fetch(`${base}/api/state`)).json()).slot.index, 1);
});

test('a restart resumes at the same slot', async () => {
  const { hub, base, dir } = await startHub();
  await post(base, { name: 'reveal' });
  await post(base, { name: 'reveal' });
  await post(base, { name: 'next' });
  await hub.stop();
  const again = await startHub({ dir });
  const state = await (await fetch(`${again.base}/api/state`)).json();
  assert.equal(state.slot.index, 2);
  assert.equal(state.completed.length, 1);
  assert.equal((await (await fetch(`${again.base}/api/whoami`, { headers: opCookie() })).json()).recovered, false);
});

test('with sync on, a command pushes a snapshot and the console sees the status', async () => {
  const pushed = [];
  const fetchImpl = async (url, init) => {
    pushed.push({ url, body: JSON.parse(init.body) });
    return { ok: true, status: 200, json: async () => ({ success: true }) };
  };
  const { base } = await startHub({ enableSync: true, target: 'staging', fetchImpl, password: 'test-password', syncMinDelay: 1 });
  await post(base, { name: 'reveal' });
  assert.ok(await until(() => pushed.length === 1));
  assert.match(pushed[0].url, /\/pairings$/);
  assert.equal(pushed[0].body.pairings.length, 39);
  assert.ok(await until(async () => (await (await fetch(`${base}/api/state`)).json()).sync.lastPushed));
  assert.equal((await (await fetch(`${base}/api/state`)).json()).sync.dirty, false);
});

test('AWS being down is invisible to the command path, and the console sees the error', async () => {
  const fetchImpl = async () => { throw new Error('ENOTFOUND'); };
  const { base } = await startHub({ enableSync: true, target: 'staging', fetchImpl, password: 'test-password', syncMinDelay: 1 });
  const res = await post(base, { name: 'reveal' });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).state.slot.shown, 'first');
  assert.ok(await until(async () => (await (await fetch(`${base}/api/state`)).json()).sync.lastError));
  assert.equal((await post(base, { name: 'reveal' })).status, 200);
});

test('the admin password never appears in logs, state, responses or errors', async () => {
  const PW = 'hunter2-SECRET-pw-9f3a';
  const logged = [];
  const orig = { log: console.log, warn: console.warn, error: console.error };
  console.log = console.warn = console.error = (...a) => { logged.push(a.map(String).join(' ')); };
  const seenHeaders = [];
  // A gateway that fails and echoes the request headers into its error text.
  const fetchImpl = async (_url, init) => { seenHeaders.push(init.headers); throw new Error(`gateway echoed ${JSON.stringify(init.headers)}`); };
  let dir; let base;
  try {
    ({ dir, base } = await startHub({ quiet: false, enableSync: true, target: 'staging', fetchImpl, password: PW, syncMinDelay: 1 }));
    await post(base, { name: 'reveal' });
    assert.ok(await until(() => seenHeaders.length >= 1));
    assert.ok(await until(async () => (await (await fetch(`${base}/api/state`)).json()).sync.lastError));
  } finally { Object.assign(console, orig); }
  assert.ok(seenHeaders.some((h) => JSON.stringify(h).includes(PW)), 'the password did reach the request header (that is its only home)');
  const everything = [
    logged.join('\n'),
    readFileSync(join(dir, 'state.json'), 'utf8'),
    JSON.stringify(await (await fetch(`${base}/api/state`)).json()),
    JSON.stringify(await (await fetch(`${base}/api/whoami`, { headers: opCookie() })).json()),
    JSON.stringify(await (await fetch(`${base}/api/show`)).json()),
    JSON.stringify(await (await post(base, { name: 'nonsense' })).json()),
  ].join('\n');
  assert.ok(!everything.includes(PW), 'password leaked');
});

test('with no admin password file the hub still starts, with sync off and the reason shown', async () => {
  // Deterministic: the password loader is injected, so this does not depend on
  // whether the machine running the tests has a staging password file.
  const { AwsError } = await import('../lib/aws.mjs');
  const loadPasswordImpl = () => { throw new AwsError('cannot read /home/x/.icup-admin-passwords/staging.txt - set ICUP_ADMIN_PASSWORD instead'); };
  const { base } = await startHub({ enableSync: true, target: 'staging', password: null, loadPasswordImpl });
  const who = await (await fetch(`${base}/api/whoami`, { headers: opCookie() })).json();
  assert.equal(who.sync, 'off');
  assert.match(who.syncNote, /Website sync is off: cannot read .*ICUP_ADMIN_PASSWORD/);
  assert.equal((await post(base, { name: 'reveal' })).status, 200, 'the show runs without the website');
});

test('an unexpected failure loading the password also degrades to sync off, without leaking its text', async () => {
  const loadPasswordImpl = () => { throw new Error('boom hunter2-SECRET'); };
  const { base } = await startHub({ enableSync: true, target: 'staging', password: null, loadPasswordImpl });
  const who = await (await fetch(`${base}/api/whoami`, { headers: opCookie() })).json();
  assert.equal(who.sync, 'off');
  assert.match(who.syncNote, /Website sync is off/);
  assert.doesNotMatch(JSON.stringify(who), /hunter2|boom/);
});

test('when the password loads, sync is on and the loader is asked for the right target', async () => {
  let asked;
  const loadPasswordImpl = (o) => { asked = o; return 'pw'; };
  const { base } = await startHub({ enableSync: true, target: 'staging', password: null, loadPasswordImpl, fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({}) }) });
  const who = await (await fetch(`${base}/api/whoami`, { headers: opCookie() })).json();
  assert.equal(who.sync, 'staging');
  assert.equal(who.syncNote, null);
  assert.equal(asked.target, 'staging');
});

test('rehearsal never syncs, even if sync was asked for', async () => {
  let called = 0;
  const fetchImpl = async () => { called += 1; return { ok: true, status: 200, json: async () => ({}) }; };
  const { base } = await startHub({ rehearsal: true, enableSync: true, password: 'pw', fetchImpl, syncMinDelay: 1 });
  await post(base, { name: 'reveal' });
  await wait(100);
  assert.equal(called, 0);
  const who = await (await fetch(`${base}/api/whoami`, { headers: opCookie() })).json();
  assert.equal(who.sync, 'off');
  assert.equal(who.rehearsal, true);
  assert.equal((await (await fetch(`${base}/api/state`)).json()).rehearsal, true);
});

test('--rehearsal selects the rehearsal state file and turns sync off; the port is overridable', () => {
  const r = parseArgs(['--rehearsal']);
  assert.match(r.statePath, /state\.rehearsal\.json$/);
  assert.equal(r.enableSync, false);
  assert.equal(r.rehearsal, true);
  assert.equal(r.port, 8722);
  const p = parseArgs(['--port', '9100', '--no-sync']);
  assert.equal(p.port, 9100);
  assert.equal(p.enableSync, false);
  assert.equal(p.statePath, undefined);
  assert.equal(parseArgs([]).enableSync, true);
  assert.throws(() => parseArgs(['--port', 'banana']), /port/);
});

test('starting twice on one port fails with a sentence, not a stack trace', async () => {
  const { port } = await startHub();
  await assert.rejects(startHub({ port }), /already in use/);
});

test('a missing show.json says how to build it', async () => {
  await assert.rejects(createHub({ showPath: '/nonexistent/show.json', port: 0, quiet: true }), /party:build/);
});

// ---------------------------------------------------------------------------
// A browser doing rude things must not take the process down.
// ---------------------------------------------------------------------------

test('a body that is not JSON is a 400', async () => {
  const { base } = await startHub();
  for (const body of ['not json at all', '{"name":', '\u0000\u0001\u0002', '{"name":"reveal"}}']) {
    const res = await post(base, body);
    assert.equal(res.status, 400, body);
    assert.match((await res.json()).error, /not JSON/);
  }
  assert.equal((await fetch(`${base}/api/state`)).status, 200);
});

test('invalid UTF-8 in the body is a 400, not a crash', async () => {
  const { base } = await startHub();
  const res = await fetch(`${base}/api/command`, { method: 'POST', headers: { ...opCookie(), 'Content-Type': 'application/json' }, body: new Uint8Array([0xff, 0xfe, 0xfd]) });
  assert.equal(res.status, 400);
});

test('a POST with no body is a 400 and the show is untouched', async () => {
  const { base } = await startHub();
  const res = await fetch(`${base}/api/command`, { method: 'POST', headers: { ...opCookie(), 'Content-Type': 'application/json' } });
  assert.equal(res.status, 400);
  assert.equal((await (await fetch(`${base}/api/state`)).json()).rev, 0);
});

test('a POST with no Content-Type at all is refused', async () => {
  const { base } = await startHub();
  const res = await fetch(`${base}/api/command`, { method: 'POST', body: new Uint8Array([123, 125]), headers: { ...opCookie(), 'Content-Type': '' } });
  assert.equal(res.status, 415);
});

test('a Content-Type that lies: JSON labelled as text is refused, text labelled as JSON is a 400', async () => {
  const { base } = await startHub();
  // Cross-site pages can send text/plain without a preflight; that must never act.
  const asText = await post(base, '{"name":"reveal"}', { 'Content-Type': 'text/plain' });
  assert.equal(asText.status, 415);
  const asForm = await post(base, 'name=reveal', { 'Content-Type': 'application/x-www-form-urlencoded' });
  assert.equal(asForm.status, 415);
  const liar = await post(base, '<html>definitely not json</html>', { 'Content-Type': 'application/json' });
  assert.equal(liar.status, 400);
  assert.equal((await (await fetch(`${base}/api/state`)).json()).rev, 0, 'none of these changed the show');
  const withCharset = await post(base, { name: 'reveal' }, { 'Content-Type': 'application/json; charset=utf-8' });
  assert.equal(withCharset.status, 200);
});

test('a command from another website is refused', async () => {
  const { base } = await startHub();
  const res = await post(base, { name: 'reveal' }, { 'Content-Type': 'application/json', Origin: 'http://evil.example' });
  assert.equal(res.status, 403);
  assert.equal((await (await fetch(`${base}/api/state`)).json()).rev, 0);
  const same = await post(base, { name: 'reveal' }, { 'Content-Type': 'application/json', Origin: base });
  assert.equal(same.status, 200);
});

test('an oversized body is a 413, not buffered without limit', async () => {
  const { base } = await startHub();
  const huge = JSON.stringify({ name: 'reveal', pad: 'x'.repeat(MAX_BODY_BYTES * 4) });
  const res = await post(base, huge);
  assert.equal(res.status, 413);
  assert.equal((await (await fetch(`${base}/api/state`)).json()).rev, 0);
});

test('an oversized chunked body with no Content-Length is also cut off', async () => {
  const { port, base } = await startHub();
  const status = await new Promise((ok) => {
    const req = request({ host: '127.0.0.1', port, path: '/api/command', method: 'POST', headers: { ...opCookie(), 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' } }, (res) => {
      res.resume();
      ok(res.statusCode);
    });
    req.on('error', () => ok('connection-closed'));
    const chunk = Buffer.alloc(8 * 1024, 120);
    let sent = 0;
    const pump = () => {
      while (sent < 4 * 1024 * 1024) {
        sent += chunk.length;
        if (!req.write(chunk)) { req.once('drain', pump); return; }
      }
      req.end();
    };
    req.on('error', () => {});
    pump();
  });
  assert.ok(status === 413 || status === 'connection-closed', `got ${status}`);
  assert.equal((await fetch(`${base}/api/state`)).status, 200, 'hub still up');
});

test('a client that lies about Content-Length and hangs up mid-body does not hurt the hub', async () => {
  const { port, base } = await startHub();
  const sock = connect(port, '127.0.0.1');
  sock.on('error', () => {});
  await new Promise((r) => sock.on('connect', r));
  sock.write(`POST /api/command HTTP/1.1\r\nHost: x\r\nCookie: icup_op=${sessionToken('test-password-1')}\r\nContent-Type: application/json\r\nContent-Length: 500\r\n\r\n{"name":"rev`);
  await wait(30);
  sock.destroy();
  await wait(50);
  assert.equal((await fetch(`${base}/api/state`)).status, 200);
  assert.equal((await post(base, { name: 'reveal' })).status, 200);
});

test('garbage on the socket, a bad request line and a bad URL do not kill the hub', async () => {
  const { port, base } = await startHub();
  for (const junk of ['\u0000\u0001garbage\r\n\r\n', 'GET\r\n\r\n', 'GET /%zz HTTP/1.1\r\nHost: x\r\n\r\n', 'GET /api/state HTTP/9.9\r\n\r\n', 'POST /api/command HTTP/1.1\r\nContent-Length: banana\r\n\r\n']) {
    const sock = connect(port, '127.0.0.1');
    sock.on('error', () => {});
    sock.on('connect', () => sock.write(junk));
    await wait(40);
    sock.destroy();
  }
  assert.equal((await fetch(`${base}/api/state`)).status, 200);
});

test('wrong methods are 405, not a crash', async () => {
  const { base } = await startHub();
  assert.equal((await fetch(`${base}/api/command`)).status, 405);
  assert.equal((await fetch(`${base}/api/state`, { method: 'POST' })).status, 405);
  assert.equal((await fetch(`${base}/api/state`, { method: 'DELETE' })).status, 405);
});

test('path traversal through the hub never reaches files outside the served directories', async () => {
  const { port, dir } = await startHub();
  writeFileSync(join(dir, 'private.txt'), 'PRIVATE-DATA');
  try { symlinkSync(join(dir, 'private.txt'), join(dir, 'cards', 'link.mp4')); } catch { /* no symlinks */ }
  const rawGet = (path) => new Promise((ok) => {
    const s = connect(port, '127.0.0.1');
    let d = '';
    s.on('data', (c) => { d += c; });
    s.on('error', () => {});
    s.on('connect', () => s.write(`GET ${path} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`));
    s.on('close', () => ok(d));
    setTimeout(() => { s.destroy(); ok(d); }, 300);
  });
  for (const p of ['/cards/../private.txt', '/cards/%2e%2e/show.json', '/cards/..%2fshow.json', '/%2e%2e/show.json', '/../show.json', '/cards/%252e%252e/private.txt', '/cards/link.mp4']) {
    const text = await rawGet(p);
    assert.doesNotMatch(text, /PRIVATE-DATA|"players"/, `leaked through ${p}`);
    assert.doesNotMatch(text, /^HTTP\/1\.1 200/, p);
  }
});

test('the hub survives a burst of mixed rude traffic', async () => {
  const { base, port } = await startHub();
  const jobs = [];
  for (let i = 0; i < 25; i++) {
    jobs.push(post(base, 'garbage').catch(() => {}));
    jobs.push(post(base, { name: 'goto', index: 1000 }).catch(() => {}));
    jobs.push(fetch(`${base}/cards/${'a'.repeat(5000)}`).catch(() => {}));
    sseClient(port).kill();
  }
  await Promise.all(jobs);
  assert.equal((await post(base, { name: 'reveal' })).status, 200);
});

test('stop() closes even open SSE streams, so shutdown is not blocked by a TV', async () => {
  const { hub, port } = await startHub();
  const c = sseClient(port);
  assert.ok(await until(() => hub.whoami().clients === 1));
  const t = Date.now();
  await hub.stop();
  assert.ok(Date.now() - t < 2000);
  c.kill();
});

// ---------------------------------------------------------------------------
// refreshFromAws: the one path that takes outside data into the state.
// ---------------------------------------------------------------------------

const jsonRes = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const refresh = (base) => post(base, { name: 'refreshFromAws' });
const slotsOf = async (base) => JSON.parse(readFileSync(join(base.dir, 'state.json'), 'utf8')).slots;

function realisticPayload() {
  const items = [];
  for (let i = 1; i <= 13; i++) {
    items.push({
      id: `day1-team-${i}`, type: 'team', day: 1, match_number: i,
      intl_team: { player1_id: `player-intl-${i * 2 - 1}`, player2_id: `player-intl-${i * 2}` },
      usa_team: { player1_id: `player-usa-${i * 2 - 1}`, player2_id: `player-usa-${i * 2}` },
      revealOrder: 'intl-first', revealStep: 0,
    });
  }
  for (let i = 1; i <= 26; i++) {
    items.push({
      id: `day2-singles-${i}`, type: 'singles', day: 2, match_number: i,
      intl_player_id: `player-intl-${i}`, usa_player_id: `player-usa-${i}`,
      revealOrder: 'intl-first', revealStep: 0,
    });
  }
  return { pairings: items };
}

async function refreshHub(payload, status) {
  const fetchImpl = async () => (payload instanceof Error ? Promise.reject(payload) : jsonRes(payload, status));
  const h = await startHub({ fetchImpl });
  const stateOf = async () => (await (await fetch(`${h.base}/api/state`)).json());
  const fullState = () => JSON.parse(readFileSync(join(h.dir, 'state.json'), 'utf8'));
  return { ...h, stateOf, fullState };
}

test('refresh with a realistic 39-item payload fills every empty side once, and persists', async () => {
  const h = await refreshHub(realisticPayload());
  const res = await refresh(h.base);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.filled, 39, 'only the empty USA sides; the INTL sides were already drawn');
  const slots = h.fullState().slots;
  assert.deepEqual(slots['1'][4].usa, ['player-usa-9', 'player-usa-10']);
  assert.deepEqual(slots['2'][25].usa, ['player-usa-26']);
  assert.deepEqual(slots['1'][4].intl, ['player-intl-9', 'player-intl-10'], 'drawn sides untouched');
  assert.equal(body.state.rev, 1);
  // idempotent: a second refresh has nothing left to fill and does not bump rev
  const again = await (await refresh(h.base)).json();
  assert.equal(again.filled, 0);
  assert.equal(again.state.rev, 1);
});

test('refresh never touches a slot that has begun to be revealed', async () => {
  const h = await refreshHub(realisticPayload());
  await post(h.base, { name: 'reveal' });
  const body = await (await refresh(h.base)).json();
  assert.equal(body.filled, 38, 'match 1 is on screen; it is left alone');
  assert.deepEqual(h.fullState().slots['1'][0].usa, ['', '']);
});

test('refresh cannot resurrect a player id that is not in the show', async () => {
  const bad = realisticPayload();
  bad.pairings[0].usa_team = { player1_id: 'player-usa-999', player2_id: 'player-usa-1' };
  bad.pairings[1].usa_team = { player1_id: 'ghost', player2_id: '' };
  bad.pairings[2].usa_team = { player1_id: '__proto__', player2_id: 'constructor' };
  bad.pairings[3].usa_team = { player1_id: 'toString', player2_id: 'hasOwnProperty' };
  bad.pairings[4].usa_team = { player1_id: { id: 'player-usa-1' }, player2_id: ['player-usa-2'] };
  bad.pairings[5].usa_team = { player1_id: 7, player2_id: null };
  const h = await refreshHub(bad);
  const res = await refresh(h.base);
  assert.equal(res.status, 200);
  const slots = h.fullState().slots['1'];
  for (let i = 0; i < 6; i++) assert.deepEqual(slots[i].usa, ['', ''], `slot ${i + 1} stayed empty`);
  assert.equal(slots[6].usa[0], 'player-usa-13', 'valid items in the same payload still apply');
  const everyId = JSON.stringify(h.fullState().slots);
  assert.doesNotMatch(everyId, /ghost|999|__proto__|constructor|toString/);
});

test('refresh will not put an international player on the USA side (or vice versa)', async () => {
  const bad = realisticPayload();
  bad.pairings[0].usa_team = { player1_id: 'player-intl-5', player2_id: 'player-intl-6' };
  bad.pairings[13].usa_player_id = 'player-intl-1';
  const h = await refreshHub(bad);
  await refresh(h.base);
  const slots = h.fullState().slots;
  assert.deepEqual(slots['1'][0].usa, ['', '']);
  assert.deepEqual(slots['2'][0].usa, ['']);
});

test('refresh ignores a missing or out-of-range revealStep, and cannot be used to reveal', async () => {
  const p = realisticPayload();
  delete p.pairings[0].revealStep;
  p.pairings[1].revealStep = 7;
  p.pairings[2].revealStep = -3;
  p.pairings[3].revealStep = 'two';
  p.pairings[4].revealStep = null;
  p.pairings[5].revealOrder = 'sideways-first';
  const h = await refreshHub(p);
  const res = await refresh(h.base);
  assert.equal(res.status, 200);
  const slots = h.fullState().slots['1'];
  for (let i = 0; i < 6; i++) {
    assert.equal(slots[i].shown, 'none');
    assert.equal(slots[i].firstSide, 'intl');
    assert.equal(slots[i].done, false);
  }
  assert.equal((await h.stateOf()).slot.shown, 'none');
});

test('refresh with hostile item shapes never throws out of the handler or corrupts the state', async () => {
  const items = [
    null, undefined, 5, 'x', [], true,
    { day: '__proto__', match_number: 1, type: 'team' },
    { day: 'constructor', match_number: 1 },
    { day: 'toString' },
    { day: 3, match_number: 1 },
    { day: 1 },
    { day: 1, match_number: 'one' },
    { day: 1, match_number: 999, type: 'team' },
    { day: 1, match_number: 1, type: 'team', intl_team: 'nope', usa_team: 12 },
    { day: 1, match_number: 1, type: 'team', usa_team: { player1_id: 'player-usa-1' } },
    { day: 2, match_number: 1, type: 'singles', usa_player_id: ['player-usa-1'] },
    { day: [1], match_number: [1] },
    { day: 1, match_number: 1, intl_team: { get player1_id() { return 'x'; } } },
  ];
  const h = await refreshHub({ pairings: items });
  const res = await refresh(h.base);
  assert.equal(res.status, 200);
  const stateAfter = h.hub.state;
  assert.equal(stateAfter.slots['1'].length, 13);
  assert.equal(stateAfter.slots['2'].length, 26);
  assert.equal(Object.keys(stateAfter.slots).sort().join(), '1,2');
  assert.equal({}.polluted, undefined, 'prototype not polluted');
  // A half-drawn team (one id, one blank) is a legitimate draw state and is accepted.
  assert.deepEqual(stateAfter.slots['1'][0].usa, ['player-usa-1', '']);
  assert.deepEqual(stateAfter.slots['2'][0].usa, [''], 'an array id on a singles side is refused');
  assert.equal((await fetch(`${h.base}/api/state`)).status, 200, 'hub alive');
});

test('refresh: a body that is not the expected shape fills nothing', async () => {
  for (const payload of [[], {}, null, 'text', 42, true, { pairings: 'nope' }, { pairings: { 0: {} } }, { pairings: null }, { items: [] }, [{ day: 1 }]]) {
    const h = await refreshHub(payload);
    const res = await refresh(h.base);
    assert.equal(res.status, 200, JSON.stringify(payload));
    assert.equal((await res.json()).filled, 0, JSON.stringify(payload));
    assert.equal((await h.stateOf()).rev, 0);
  }
});

test('refresh: AWS errors are a 502 with a status code only, and the state is unchanged', async () => {
  const down = await refreshHub(new Error('ENOTFOUND secret-host.internal'));
  const r1 = await refresh(down.base);
  assert.equal(r1.status, 502);
  assert.doesNotMatch(JSON.stringify(await r1.json()), /secret-host/);
  const err500 = await refreshHub({}, 500);
  const r2 = await refresh(err500.base);
  assert.equal(r2.status, 502);
  assert.match((await r2.json()).error, /HTTP 500/);
  const notJson = await startHub({ fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } }) });
  const r3 = await refresh(notJson.base);
  assert.equal(r3.status, 502);
  assert.equal((await (await fetch(`${notJson.base}/api/state`)).json()).rev, 0);
});

// F4: Refresh from AWS is as undoable as everything else.
test('refresh can be undone: one Undo puts the slots back, and rev advances both ways', async () => {
  const h = await refreshHub(realisticPayload());
  const before = JSON.parse(JSON.stringify(h.hub.state));   // nothing is on disk until the first change
  assert.deepEqual(before.slots['1'][0].usa, ['', '']);
  const filled = await (await refresh(h.base)).json();
  assert.equal(filled.filled, 39);
  assert.equal(filled.state.rev, before.rev + 1);
  assert.deepEqual(h.fullState().slots['1'][0].usa, ['player-usa-1', 'player-usa-2']);

  const undone = await (await post(h.base, { name: 'undo' })).json();
  assert.equal(undone.ok, true);
  assert.equal(undone.state.rev, before.rev + 2, 'undo advances rev too');
  const after = h.fullState();
  assert.deepEqual(after.slots['1'][0].usa, ['', ''], 'the slot the website filled is empty again');
  assert.deepEqual(after.slots['2'][25].usa, [''], 'and so is day 2');
  assert.deepEqual(after.slots['1'][0].intl, before.slots['1'][0].intl, 'the drawn sides are as they were');
  assert.equal(after.history.length, before.history.length, 'the refresh entry was consumed, not stacked');
  // and nothing else was disturbed: the next refresh can fill it again
  assert.equal((await (await refresh(h.base)).json()).filled, 39);
});

// F5: a state the hub cannot project must never be committed, or every later
// /api/state, every SSE reconnect and every command fails until a restart.
test('a command whose result cannot be projected fails cleanly, and the show carries on', async () => {
  const { hub, base, port } = await startHub({
    // Only setFirstSide is sabotaged, so everything else is the real reducer.
    reduceImpl: (state, cmd, show) => (cmd.name === 'setFirstSide' ? { ...state, slots: null } : reduce(state, cmd, show)),
  });
  await post(base, { name: 'reveal' });
  const good = await (await fetch(`${base}/api/state`)).json();

  const bad = await post(base, { name: 'setFirstSide', side: 'usa' });
  assert.equal(bad.status, 500);
  assert.match((await bad.json()).error, /internal fault/);

  // the old state is still the live one, and still projectable
  const still = await (await fetch(`${base}/api/state`)).json();
  assert.deepEqual(still, good);
  assert.equal(hub.state.slots['1'].length, 13, 'the bad state was never committed');

  // the stage's own reconnect still works
  const client = sseClient(port);
  assert.ok(await until(() => client.frames.length >= 1), '/events still serves a snapshot');
  assert.equal(client.frames[0].data.rev, good.rev);
  client.kill();

  // and the next real command is accepted
  const ok = await post(base, { name: 'reveal' });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).state.slot.shown, 'both');
});

// F2: the night ends with the 39th Next and then Ctrl-C.
test('the last pairing is pushed during stop(), not cancelled by it', async () => {
  let stopping = false;
  const when = [];
  const pushed = [];
  const fetchImpl = async (url, init) => {
    when.push(stopping ? 'during stop()' : 'before stop()');
    pushed.push({ url, body: JSON.parse(init.body) });
    return { ok: true, status: 200, json: async () => ({ success: true }) };
  };
  // A minute of retry delay: the armed timer cannot be what pushes this.
  const { hub, base, dir } = await startHub({
    enableSync: true, target: 'staging', fetchImpl, password: 'pw', syncMinDelay: 60000,
  });
  await post(base, { name: 'next' });
  await wait(50);
  assert.deepEqual(when, [], 'nothing has gone to the website yet');
  assert.equal(JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')).sync.dirty, true);

  stopping = true;
  await hub.stop();
  assert.deepEqual(when, ['during stop()']);
  assert.equal(pushed.length, 1);
  assert.match(pushed[0].url, /\/pairings$/);
  assert.equal(pushed[0].body.pairings.length, 39);
  assert.equal(pushed[0].body.pairings.find((p) => p.day === 1 && p.match_number === 1).revealStep, 2, 'the match that was just finished');
  // and the push was recorded before the hub closed, so a restart will not redo it
  const onDisk = JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8'));
  assert.equal(onDisk.sync.dirty, false);
  assert.ok(onDisk.sync.lastPushed);
});

test('a hub booted on a state that was never pushed finishes the job, with no command at all', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hub-dirty-'));
  const first = await startHub({ dir });                    // sync off: this leaves work behind
  await post(first.base, { name: 'next' });
  await first.hub.stop();
  assert.equal(JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')).sync.dirty, true);

  const pushed = [];
  const fetchImpl = async (_url, init) => {
    pushed.push(JSON.parse(init.body));
    return { ok: true, status: 200, json: async () => ({ success: true }) };
  };
  const { base } = await startHub({ dir, enableSync: true, target: 'staging', fetchImpl, password: 'pw', syncMinDelay: 1 });
  assert.ok(await until(() => pushed.length >= 1), 'the restart pushed what the last run left unpushed');
  assert.equal(pushed[0].pairings.length, 39);
  assert.ok(await until(async () => (await (await fetch(`${base}/api/state`)).json()).sync.dirty === false));
});

test('a dead network cannot hold Ctrl-C: stop() gives up on the push and closes', async () => {
  const fetchImpl = () => new Promise(() => {});           // the venue wifi, gone
  const { hub, base } = await startHub({
    enableSync: true, target: 'staging', fetchImpl, password: 'pw', syncMinDelay: 1, stopFlushMs: 200,
  });
  await post(base, { name: 'next' });
  await wait(60);                                          // the push is away and hanging
  const started = Date.now();
  await hub.stop();
  const took = Date.now() - started;
  assert.ok(took < 2000, `stop() took ${took}ms`);
  await assert.rejects(() => fetch(`${base}/api/state`), 'and the hub really is closed');
  assert.ok(STOP_FLUSH_MS <= 3000, `the real cap is ${STOP_FLUSH_MS}ms: Ctrl-C has to come back`);
});

// R2: and it says so, because a silent pause reads as a freeze and the next
// move is a second Ctrl-C at the worst possible moment.
test('Ctrl-C says it is sending the last pairing, and says whether it got there', () => {
  const sending = shutdownLines({ unpushed: true, stillUnpushed: false });
  assert.match(sending.before.join('\n'), /Sending the last pairing to the website/);
  assert.match(sending.before.join('\n'), /few seconds/, 'it says the wait is expected');
  assert.match(sending.after.join('\n'), /^\s+Sent\./m);

  const failed = shutdownLines({ unpushed: true, stillUnpushed: true });
  assert.deepEqual(failed.before, sending.before, 'the same line goes out before either outcome');
  const text = failed.after.join('\n');
  assert.match(text, /did not get through/);
  assert.match(text, /saved on this laptop/, 'nothing was lost');
  assert.match(text, /npm run party:start/, 'and what to do about it');
  assert.doesNotMatch(text, /Sent\./);

  // nothing to push (sync off, or everything already sent): not a word
  assert.deepEqual(shutdownLines({ unpushed: false, stillUnpushed: false }), { before: [], after: [] });
  assert.deepEqual(shutdownLines({ unpushed: false, stillUnpushed: true }), { before: [], after: [] });
  // no codes, no stacks, no password anywhere in any of it
  const everything = [sending, failed].flatMap((l) => [...l.before, ...l.after]).join('\n');
  assert.doesNotMatch(everything, /EACCES|ENOTFOUND|Error|undefined|[a-z]+-[a-z]+-\d{4}/);
});

// F3: the two boot failures a person reads in the terminal when the show cannot start.
test('a damaged show.json is a sentence with the command that fixes it, not a parser message', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hub-bad-show-'));
  const showPath = join(dir, 'show.json');
  writeFileSync(showPath, '{"built":"now","players":[{"id":"player-intl-1"}');   // truncated mid-write
  await assert.rejects(
    () => createHub({ showPath, statePath: join(dir, 'state.json'), port: 0, enableSync: false, quiet: true, operatorPassword: 'x', operatorPasswordPath: join(dir, 'op.txt') }),
    (e) => {
      assert.match(e.message, /npm run party:build/);
      assert.doesNotMatch(e.message, /Unexpected token|in JSON at position|SyntaxError|EACCES|ENOENT|\n\s+at /);
      assert.ok(e.message.length < 200, e.message);
      return true;
    },
  );
});

test('a folder the hub cannot write the password into names the folder, not an errno', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hub-ro-'));
  const locked = join(dir, 'locked');
  mkdirSync(locked);
  chmodSync(locked, 0o500);                                 // readable, not writable
  try {
    await assert.rejects(
      () => createHub({
        showPath: fixtureShow(dir), statePath: join(dir, 'state.json'), port: 0, enableSync: false, quiet: true,
        operatorPassword: null, operatorPasswordPath: join(locked, 'operator-password.txt'),
      }),
      (e) => {
        assert.ok(e.message.includes(locked), e.message);
        assert.match(e.message, /cannot save the console password/);
        assert.doesNotMatch(e.message, /EACCES|EPERM|ENOSPC|errno|\n\s+at /);
        assert.doesNotMatch(e.message, /[a-z]+-[a-z]+-\d{4}/, 'and never the password it was trying to save');
        return true;
      },
    );
  } finally {
    chmodSync(locked, 0o700);
  }
});

// F9: a HEAD is not a stage.
test('HEAD /events answers without attaching a client that would never be read', async () => {
  const { hub, base } = await startHub();
  const res = await fetch(`${base}/events`, { method: 'HEAD' });
  assert.equal(res.status, 200);
  assert.equal(await res.text(), '');
  assert.equal(hub.whoami().clients, 0, 'a HEAD is counted as nobody');
  await fetch(`${base}/events`, { method: 'HEAD' });
  assert.equal(hub.whoami().clients, 0);
});

// ---- Task 10B: the password on the operator console ----

test('gate 13: GET /operator with no cookie is the login page, not the console - under every spelling', async () => {
  // The real directory layout, not the fixture: the point is that no URL
  // spelling can reach the console through the static handler.
  const realPublic = fileURLToPath(new URL('../public', import.meta.url));
  const realPrivate = fileURLToPath(new URL('../private', import.meta.url));
  assert.equal(existsSync(join(realPublic, 'operator.html')), false, 'the console page must not live in public/');
  assert.equal(existsSync(join(realPublic, 'login.html')), false, 'the login page must not live in public/');
  const { base } = await startHub({ publicDir: realPublic, privateDir: realPrivate });
  const spellings = ['/operator', '/operator.html', '/%6Fperator.html', '/operator%2Ehtml', '/Operator.html', '/OPERATOR.HTML', '/operator.html/'];
  for (const path of spellings) {
    const res = await fetch(`${base}${path}`);
    const text = await res.text();
    assert.doesNotMatch(text, /<h1>operator<\/h1>/, `${path} must not serve the console`);
    if (path === '/operator') {
      assert.equal(res.status, 200);
      assert.match(text, /Unlock/);
    } else {
      assert.equal(res.status, 404, `${path} is not a page at all`);
    }
  }
});

test('gate 14: GET /operator with the cookie is the console, not the login page', async () => {
  const { base } = await startHub();
  const text = await (await fetch(`${base}/operator`, { headers: opCookie() })).text();
  assert.match(text, /<h1>operator<\/h1>/);
  assert.doesNotMatch(text, /Unlock/);
});

test('gate 15: an unauthenticated command is refused and never reaches the reducer', async () => {
  const { base } = await startHub();
  const res = await postNoAuth(base, { name: 'reveal' }, { 'Content-Type': 'application/json' });
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.needPassword, true);
  assert.equal(body.ok, false);
  assert.equal(body.error, 'The console is not signed in. Reload this page and type the password.');
  const state = await (await fetch(`${base}/api/state`)).json();
  assert.equal(state.slot.shown, 'none', 'the reveal did not happen');
  assert.equal(state.rev, 0, 'the state was not touched at all');
  // and the same command, signed in, does happen: the refusal above was the gate
  assert.equal((await (await post(base, { name: 'reveal' })).json()).state.slot.shown, 'first');
});

test('gate 16: login with the right password sets an HttpOnly SameSite=Strict cookie that works on /api/command', async () => {
  const { base } = await startHub();
  const res = await login(base, 'test-password-1');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  const setCookie = res.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  assert.match(setCookie, /Path=\//);
  const cookie = setCookie.split(';')[0];
  const cmd = await postNoAuth(base, { name: 'reveal' }, { 'Content-Type': 'application/json', Cookie: cookie });
  assert.equal(cmd.status, 200);
});

test('gate 17: a wrong password is a 401 that echoes neither the password nor the token', async () => {
  const { base } = await startHub();
  const res = await login(base, 'wrong');
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error, 'That is not the password.');
  const everything = JSON.stringify([...res.headers.entries()]);
  assert.equal(res.headers.get('set-cookie'), null);
  const again = await login(base, 'wrong');
  const dump = everything + JSON.stringify(await again.json());
  assert.ok(!dump.includes('test-password-1'));
  assert.ok(!dump.includes(sessionToken('test-password-1')));
  assert.ok(!dump.includes('wrong'), 'the submitted guess is not echoed either');
});

test('gate 18: eleven wrong tries lock the address out, even for the right password', async () => {
  const { base } = await startHub();
  for (let i = 0; i < 11; i++) await login(base, `wrong-${i}`);
  const res = await login(base, 'test-password-1');
  assert.equal(res.status, 429);
  const body = await res.json();
  assert.match(body.error, /wait/i);
  assert.equal(res.headers.get('set-cookie'), null, 'no cookie while locked out');
});

test('gate 19: /api/whoami needs the cookie, and never carries the password or the token', async () => {
  const { base } = await startHub();
  const no = await fetch(`${base}/api/whoami`);
  assert.equal(no.status, 401);
  assert.equal((await no.json()).needPassword, true);
  const yes = await fetch(`${base}/api/whoami`, { headers: opCookie() });
  assert.equal(yes.status, 200);
  const text = JSON.stringify(await yes.json());
  assert.ok(!text.includes('test-password-1'));
  assert.ok(!text.includes(sessionToken('test-password-1')));
});

test('gate 20: the stage stays public - no cookie needed for anything it consumes', async () => {
  const { base, port } = await startHub();
  for (const path of ['/stage', '/api/show', '/api/state', '/cards/i1-4x9.mp4', '/']) {
    const res = await fetch(`${base}${path}`);
    assert.equal(res.status, 200, `${path} is public`);
    await res.arrayBuffer();
  }
  const sse = sseClient(port);
  try {
    assert.ok(await until(() => sse.frames.some((f) => f.event === 'state')), 'an unauthenticated client gets a state frame');
  } finally {
    sse.kill();
  }
});

test('gate 21: /api/login has the same protections as /api/command', async () => {
  const { base } = await startHub();
  const plain = await login(base, 'test-password-1', { 'Content-Type': 'text/plain' });
  assert.equal(plain.status, 415);
  // The hub closes the socket after a 413, so either the 413 or the reset is right.
  const huge = await login(base, JSON.stringify({ password: 'x'.repeat(MAX_BODY_BYTES + 10) }), { 'Content-Type': 'application/json' }).then((r) => r.status, () => 'connection-closed');
  assert.ok(huge === 413 || huge === 'connection-closed', `got ${huge}`);
  const foreign = await login(base, 'test-password-1', { 'Content-Type': 'application/json', Origin: 'http://evil.example' });
  assert.equal(foreign.status, 403);
  assert.equal(foreign.headers.get('set-cookie'), null);
  const noField = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"nope":1}' });
  assert.equal(noField.status, 400);
  assert.equal((await fetch(`${base}/api/login`)).status, 405);
});

test('gate 22: a generated password is written to the file and appears in no public response', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gen-'));
  const path = join(dir, 'operator-password.txt');
  const { hub, base } = await startHub({ dir, operatorPassword: null, operatorPasswordPath: path });
  assert.equal(hub.operatorPasswordSource, 'generated');
  const generated = readFileSync(path, 'utf8').trim();
  assert.equal(generated, hub.operatorPassword);
  assert.match(generated, /^[a-z]+-[a-z]+-\d{4}$/);
  const bodies = [JSON.stringify(hub.whoami()), ...(await Promise.all(['/api/state', '/api/show', '/'].map(async (p) => (await fetch(`${base}${p}`)).text())))];
  for (const b of bodies) assert.ok(!b.includes(generated));
  assert.equal((await login(base, generated)).status, 200, 'and the generated password does unlock the console');
});

// --- /api/board --------------------------------------------------------------
// It carries every pairing of the night. /events and /api/state are public
// because the stage reads them, so this one must not be, or anyone on the venue
// wifi has the whole draw before the first reveal.
test('the board is gated, and the public endpoints never carry another match', async () => {
  const { base } = await startHub();
  await post(base, { name: 'assign', side: 'usa', players: ['player-usa-11', 'player-usa-12'] });
  await post(base, { name: 'goto', day: 2, index: 7 });
  await post(base, { name: 'assign', side: 'usa', players: ['player-usa-9'] });
  await post(base, { name: 'goto', day: 1, index: 0 });

  const denied = await fetch(`${base}/api/board`);
  assert.equal(denied.status, 401);
  assert.equal((await denied.json()).needPassword, true);
  for (const cookie of [{}, { Cookie: 'icup_op=wrong' }, { Cookie: 'icup_opx=test-password-1' }]) {
    assert.equal((await fetch(`${base}/api/board`, { headers: cookie })).status, 401);
  }

  // The day 2 draw exists, and the public state does not mention it. (index 7 is
  // the command's count-from-0, so it is match 8.)
  const board = await (await fetch(`${base}/api/board`, { headers: opCookie() })).json();
  assert.deepEqual(board.days['2'][7].usa, ['player-usa-9']);
  assert.equal(board.days['2'][7].index, 8);
  assert.deepEqual(board.days['1'][0].usa, ['player-usa-11', 'player-usa-12']);
  assert.equal(board.days['1'].length, 13);
  assert.equal(board.days['2'].length, 26);
  assert.equal(board.day, 1);
  assert.equal(board.current['2'], 7);
  // /api/show carries the roster, so every id is in it by design; /api/state is
  // the one that must not say who has been DRAWN anywhere but here and next.
  const publicState = await (await fetch(`${base}/api/state`)).text();
  assert.doesNotMatch(publicState, /player-usa-9"/, '/api/state leaks the day 2 draw');
  assert.match(publicState, /player-usa-11/, 'it does carry the match in play');
});

// The console fetches the board when a dialog opens, so a stale one would hide
// a player who has just been drawn - or offer one who has.
test('the board is read fresh: every command shows up in the next read', async () => {
  const { base } = await startHub();
  const board = async () => (await (await fetch(`${base}/api/board`, { headers: opCookie() })).json());
  assert.deepEqual((await board()).days['1'][0].usa, ['', '']);

  await post(base, { name: 'assign', side: 'usa', players: ['player-usa-3', 'player-usa-4'] });
  assert.deepEqual((await board()).days['1'][0].usa, ['player-usa-3', 'player-usa-4']);

  await post(base, { name: 'next' });
  const afterNext = await board();
  assert.equal(afterNext.days['1'][0].done, true);
  assert.equal(afterNext.current['1'], 1, 'it says where the operator now is');

  await post(base, { name: 'undo' });
  const afterUndo = await board();
  assert.equal(afterUndo.days['1'][0].done, false);
  assert.equal(afterUndo.current['1'], 0);
});

test('one command jumps across days, so one Undo comes back', async () => {
  const { base } = await startHub();
  const state = async () => (await (await fetch(`${base}/api/state`)).json());
  assert.equal((await state()).day, 1);

  const jumped = await (await post(base, { name: 'goto', day: 2, index: 5 })).json();
  assert.equal(jumped.ok, true);
  assert.equal(jumped.state.day, 2);
  assert.equal(jumped.state.slot.index, 6);
  assert.equal(jumped.state.mode, 'live');

  const back = await (await post(base, { name: 'undo' })).json();
  assert.equal(back.state.day, 1, 'a single Undo is enough');
  assert.equal(back.state.slot.index, 1);

  // A day that is not 1 or 2, and an index off the end of the day asked for.
  for (const cmd of [{ name: 'goto', day: 3, index: 0 }, { name: 'goto', day: 2, index: 26 }]) {
    const bad = await post(base, cmd);
    assert.equal(bad.status, 400, JSON.stringify(cmd));
  }
  // Day 1 has 13 matches and day 2 has 26: index 20 is only valid on day 2.
  assert.equal((await post(base, { name: 'goto', day: 1, index: 20 })).status, 400);
  assert.equal((await post(base, { name: 'goto', day: 2, index: 20 })).status, 200);
});

// --- screens -----------------------------------------------------------------

const es = async (base, screen) => {
  // Opens an event stream the way a stage does, reads the first frame, and leaves.
  const ctrl = new AbortController();
  const url = screen === undefined ? `${base}/events` : `${base}/events?screen=${encodeURIComponent(screen)}`;
  const res = await fetch(url, { signal: ctrl.signal });
  const reader = res.body.getReader();
  await reader.read();
  ctrl.abort();
  return res;
};

test('a stage names itself when it connects, and the console can then set it', async () => {
  const { base } = await startHub();
  const wire = async () => (await (await fetch(`${base}/api/state`)).json());

  // Before anything connects there is one screen: the one there has always been.
  assert.deepEqual((await wire()).screens, { main: 'mirror' });

  await es(base, 'bar');
  assert.deepEqual((await wire()).screens, { main: 'mirror', bar: 'mirror' });

  const set = await (await post(base, { name: 'setScreen', screen: 'bar', role: 'list' })).json();
  assert.equal(set.ok, true);
  assert.deepEqual(set.state.screens, { main: 'mirror', bar: 'list' });
  assert.deepEqual((await wire()).screens, { main: 'mirror', bar: 'list' });

  // A screen that never connected cannot be set: it would sit in the console for
  // ever with nothing behind it.
  const ghost = await post(base, { name: 'setScreen', screen: 'nowhere', role: 'hold' });
  assert.equal(ghost.status, 400);
  assert.match((await ghost.json()).error, /no screen called "nowhere"/);
  // Nor can a role the stage does not understand.
  const disco = await post(base, { name: 'setScreen', screen: 'bar', role: 'disco' });
  assert.equal(disco.status, 400);
  // The refusal lists the buttons the operator is looking at, every one of them.
  const said = (await disco.json()).error;
  for (const role of SCREEN_ROLES) assert.ok(said.includes(SCREEN_ROLE_LABELS[role]), `${role}: ${said}`);
  assert.equal((await post(base, { name: 'setScreen', screen: 'bar', role: '__proto__' })).status, 400);

  // Player films: the films loop is a screen role like the others.
  const films = await (await post(base, { name: 'setScreen', screen: 'bar', role: 'films' })).json();
  assert.equal(films.ok, true);
  assert.deepEqual(films.state.screens, { main: 'mirror', bar: 'films' });
});

// Jump to a film: the console names a player, the hub turns that into a cue for
// one screen and puts that screen on the films in the same breath.
const withFilms = (show) => {
  for (const p of show.players) {
    if (p.id === 'player-intl-1' || p.id === 'player-usa-1') p.film = `cards/${p.id}-16x9-web.mp4`;
  }
};

test('Jump to a film cues one screen and puts it on the films', async () => {
  const { base } = await startHub({ showTweak: withFilms });
  const wire = async () => (await (await fetch(`${base}/api/state`)).json());
  await es(base, 'bar');

  // Before anything is asked for there are no cues at all.
  assert.deepEqual((await wire()).filmCues, {});

  const first = await (await post(base, { name: 'playFilm', screen: 'bar', playerId: 'player-usa-1' })).json();
  assert.equal(first.ok, true);
  assert.equal(first.state.screens.bar, 'films', 'choosing a film is also how a screen is put on the films');
  assert.deepEqual(first.state.filmCues, { bar: { playerId: 'player-usa-1', seq: 1 } });
  assert.deepEqual((await wire()).filmCues, { bar: { playerId: 'player-usa-1', seq: 1 } });

  // The number only ever goes up, which is what lets the stage tell a new jump
  // from the same one arriving again in the next state frame.
  const again = await (await post(base, { name: 'playFilm', screen: 'bar', playerId: 'player-usa-1' })).json();
  assert.deepEqual(again.state.filmCues, { bar: { playerId: 'player-usa-1', seq: 2 } });
  const other = await (await post(base, { name: 'playFilm', screen: 'main', playerId: 'player-intl-1' })).json();
  assert.deepEqual(other.state.filmCues, {
    bar: { playerId: 'player-usa-1', seq: 2 },
    main: { playerId: 'player-intl-1', seq: 3 },
  });

  // A screen that never connected, and a player with no film, are both refused
  // in words rather than quietly leaving a television on something else.
  const ghost = await post(base, { name: 'playFilm', screen: 'nowhere', playerId: 'player-usa-1' });
  assert.equal(ghost.status, 400);
  assert.match((await ghost.json()).error, /no screen called "nowhere"/);
  for (const playerId of ['player-intl-2', 'nobody', '', null, 7, {}, '__proto__']) {
    const no = await post(base, { name: 'playFilm', screen: 'bar', playerId });
    assert.equal(no.status, 400, JSON.stringify(playerId));
    assert.match((await no.json()).error, /no film for that player/i, JSON.stringify(playerId));
  }
  // And none of that moved what was already cued.
  assert.deepEqual((await wire()).filmCues.bar, { playerId: 'player-usa-1', seq: 2 });

  // A cue is no more show state than a role is: no history, no undo.
  await post(base, { name: 'goto', index: 1 });
  await post(base, { name: 'playFilm', screen: 'bar', playerId: 'player-intl-1' });
  const undone = await (await post(base, { name: 'undo' })).json();
  assert.equal(undone.state.slot.index, 1, 'Undo reversed the jump, not the film');
  assert.equal(undone.state.filmCues.bar.playerId, 'player-intl-1', 'and the cue is still where it was');
});

test('a show with no films has no film to jump to', async () => {
  const { base } = await startHub();
  await es(base, 'bar');
  const no = await post(base, { name: 'playFilm', screen: 'bar', playerId: 'player-intl-1' });
  assert.equal(no.status, 400);
  assert.equal((await (await fetch(`${base}/api/state`)).json()).screens.bar, 'mirror',
    'a refused jump leaves the screen alone');
});

// A surface fetches the roster once and then lives on state frames. If the show
// is rebuilt and the hub restarted - which happens every time a player's photo
// arrives - an open console would otherwise keep yesterday's players for the
// rest of the night, looking perfectly healthy while doing it.
test('every frame carries the show it was built from, so a surface can tell it is stale', async () => {
  const { base, dir } = await startHub();
  const show = JSON.parse(readFileSync(join(dir, 'show.json'), 'utf8'));
  const wire = await (await fetch(`${base}/api/state`)).json();
  assert.equal(wire.built, show.built, 'the state frame names the build');

  // And on a command's reply and over the stream, not only on a poll.
  const after = await (await post(base, { name: 'goto', index: 1 })).json();
  assert.equal(after.state.built, show.built);
  await es(base, 'bar');
  const roles = await (await post(base, { name: 'setScreen', screen: 'bar', role: 'films' })).json();
  assert.equal(roles.state.built, show.built, 'screen frames carry it too');

  // A hub restarted on a REBUILT show hands out the new stamp, which is the
  // whole point: the number changing is what tells a surface to fetch again.
  const second = await startHub({ dir, showTweak: (s) => { s.built = 'rebuilt-later'; } });
  assert.equal((await (await fetch(`${second.base}/api/state`)).json()).built, 'rebuilt-later');
});

test('Sync puts every screen back on the show in one command', async () => {
  const { base } = await startHub();
  await es(base, 'bar');
  await es(base, 'back-room');
  await post(base, { name: 'setScreen', screen: 'bar', role: 'slideshow' });
  await post(base, { name: 'setScreen', screen: 'back-room', role: 'hold' });
  await post(base, { name: 'setScreen', screen: 'main', role: 'list' });

  const synced = await (await post(base, { name: 'syncScreens' })).json();
  assert.deepEqual(synced.state.screens, { main: 'mirror', bar: 'mirror', 'back-room': 'mirror' });
});

// Back on the show means back on the show: a screen opened later must not start
// at a film somebody asked for an hour ago.
test('Sync forgets which film each screen was sent to', async () => {
  const { base } = await startHub({ showTweak: withFilms });
  await es(base, 'bar');
  await post(base, { name: 'playFilm', screen: 'bar', playerId: 'player-usa-1' });
  const synced = await (await post(base, { name: 'syncScreens' })).json();
  assert.deepEqual(synced.state.filmCues, {});
  assert.equal(synced.state.screens.bar, 'mirror');
});

// A role is about the room, not about the draw. If it reached the saved show it
// would be undoable and would push to the website, both of which are wrong.
test('a screen role is never saved, never undoable and never pushed', async () => {
  const pushes = [];
  const fetchImpl = async (url, init) => { pushes.push(String(url)); return { ok: true, status: 200, json: async () => ({}) }; };
  const { base, dir } = await startHub({ enableSync: true, target: 'staging', fetchImpl, password: 'test-password', syncMinDelay: 1 });
  await es(base, 'bar');

  // The state file is written by the first command, not at boot: give it one.
  await post(base, { name: 'goto', index: 1 });
  await new Promise((r) => setTimeout(r, 60));
  const before = readFileSync(join(dir, 'state.json'), 'utf8');
  const sent = pushes.length;
  await post(base, { name: 'setScreen', screen: 'bar', role: 'list' });
  await post(base, { name: 'syncScreens' });
  await new Promise((r) => setTimeout(r, 60));

  assert.equal(readFileSync(join(dir, 'state.json'), 'utf8'), before, 'the saved show did not move');
  assert.equal(pushes.length, sent, 'nothing was pushed to the website');
  assert.doesNotMatch(before, /screens/, 'roles are not in the saved show at all');
  assert.doesNotMatch(before, /filmCues/, 'nor is the film a screen was sent to');

  // And a single Undo reaches past both screen commands to the jump, because
  // neither of them put anything in the history.
  const undone = await (await post(base, { name: 'undo' })).json();
  assert.equal(undone.state.slot.index, 1, 'Undo reversed the jump, not a screen change');
});

test('a hub that restarts brings every screen back on the show', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hub-'));
  const first = await startHub({ dir });
  await es(first.base, 'bar');
  await post(first.base, { name: 'setScreen', screen: 'bar', role: 'hold' });
  await post(first.base, { name: 'goto', index: 4 });
  await first.hub.stop();

  const again = await startHub({ dir });
  const wire = await (await fetch(`${again.base}/api/state`)).json();
  assert.equal(wire.slot.index, 5, 'the show carried on from where it was');
  assert.deepEqual(wire.screens, { main: 'mirror' }, 'and every screen is back on it');
  assert.deepEqual(wire.filmCues, {}, 'with no film anybody was sent to');
});

test('a stranger on the wifi cannot fill the console with screens', async () => {
  const { base } = await startHub();
  for (let i = 0; i < 30; i++) await es(base, `junk-${i}`);
  const wire = await (await fetch(`${base}/api/state`)).json();
  const count = Object.keys(wire.screens).length;
  assert.ok(count <= MAX_SCREENS, `${count} screens is past the cap of ${MAX_SCREENS}`);
  assert.equal(wire.screens.main, 'mirror', 'and the main screen is never crowded out');
  // Setting a role is gated, whatever names got in.
  assert.equal((await fetch(`${base}/api/command`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'setScreen', screen: 'junk-0', role: 'hold' }),
  })).status, 401);
});

test('a stage with no name, or a daft one, is the main screen', async () => {
  const { base } = await startHub();
  await es(base);                    // /events with no query at all: today's stage
  await es(base, 'bar room');        // a space is not a name
  await es(base, '');
  assert.deepEqual((await (await fetch(`${base}/api/state`)).json()).screens, { main: 'mirror' });
});
