import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { connect } from 'node:net';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHub, parseArgs, MAX_BODY_BYTES } from '../hub.mjs';
import { CommandError } from '../lib/state.mjs';

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
  writeFileSync(join(publicDir, 'operator.html'), '<h1>operator</h1>');
  const { dir: _d, showTweak, ...rest } = opts;
  const hub = await createHub({
    showPath: fixtureShow(dir, showTweak),
    statePath: join(dir, 'state.json'),
    cardsDir, publicDir, port: 0, enableSync: false, quiet: true,
    ...rest,
  });
  hubs.push(hub);
  const port = hub.server.address().port;
  return { hub, dir, port, base: `http://127.0.0.1:${port}` };
}

// Whatever a test leaves running is closed here so a failure cannot hang the suite.
import { after } from 'node:test';
after(async () => { for (const h of hubs) { try { await h.stop(); } catch { /* already stopped */ } } });

const post = (base, body, headers = { 'Content-Type': 'application/json' }) =>
  fetch(`${base}/api/command`, { method: 'POST', headers, body: typeof body === 'string' || body === undefined ? body : JSON.stringify(body) });

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
  assert.match(await (await fetch(`${base}/operator`)).text(), /operator/);
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
  const who = await (await fetch(`${base}/api/whoami`)).json();
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
  const who = await (await fetch(`${base}/api/whoami`)).json();
  assert.equal(who.recovered, true);
  assert.match(who.recoveredReason, /unusable|bad JSON/i);
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
  assert.equal((await (await fetch(`${again.base}/api/whoami`)).json()).recovered, false);
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
    JSON.stringify(await (await fetch(`${base}/api/whoami`)).json()),
    JSON.stringify(await (await fetch(`${base}/api/show`)).json()),
    JSON.stringify(await (await post(base, { name: 'nonsense' })).json()),
  ].join('\n');
  assert.ok(!everything.includes(PW), 'password leaked');
});

test('with no admin password the hub still starts, with sync off and the reason shown', async () => {
  const saved = process.env.ICUP_ADMIN_PASSWORD;
  delete process.env.ICUP_ADMIN_PASSWORD;
  try {
    const { base } = await startHub({ enableSync: true, target: 'staging', password: null });
    const who = await (await fetch(`${base}/api/whoami`)).json();
    // Either the dev machine has a staging password file (sync on) or it does not (sync off, with a note).
    assert.ok(who.sync === 'staging' || (who.sync === 'off' && /Website sync is off/.test(who.syncNote)));
  } finally { if (saved !== undefined) process.env.ICUP_ADMIN_PASSWORD = saved; }
});

test('rehearsal never syncs, even if sync was asked for', async () => {
  let called = 0;
  const fetchImpl = async () => { called += 1; return { ok: true, status: 200, json: async () => ({}) }; };
  const { base } = await startHub({ rehearsal: true, enableSync: true, password: 'pw', fetchImpl, syncMinDelay: 1 });
  await post(base, { name: 'reveal' });
  await wait(100);
  assert.equal(called, 0);
  const who = await (await fetch(`${base}/api/whoami`)).json();
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
  const res = await fetch(`${base}/api/command`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: new Uint8Array([0xff, 0xfe, 0xfd]) });
  assert.equal(res.status, 400);
});

test('a POST with no body is a 400 and the show is untouched', async () => {
  const { base } = await startHub();
  const res = await fetch(`${base}/api/command`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
  assert.equal(res.status, 400);
  assert.equal((await (await fetch(`${base}/api/state`)).json()).rev, 0);
});

test('a POST with no Content-Type at all is refused', async () => {
  const { base } = await startHub();
  const res = await fetch(`${base}/api/command`, { method: 'POST', body: new Uint8Array([123, 125]), headers: { 'Content-Type': '' } });
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
    const req = request({ host: '127.0.0.1', port, path: '/api/command', method: 'POST', headers: { 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' } }, (res) => {
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
  sock.write(`POST /api/command HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: 500\r\n\r\n{"name":"rev`);
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
