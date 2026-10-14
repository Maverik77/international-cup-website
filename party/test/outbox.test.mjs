import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOutbox } from '../lib/outbox.mjs';
import { loadPassword, putPairings, getPairings, putPlayers, getPlayers, AwsError, API_URLS } from '../lib/aws.mjs';
import { toPairingItems } from '../lib/pairings.mjs';
import { initialState, reduce } from '../lib/state.mjs';
import { indexShow } from '../build/build-show.mjs';

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

// A controllable clock: schedule() records, run() fires the earliest.
function fakeClock() {
  let seq = 0;
  const jobs = new Map();
  return {
    schedule: (fn, ms) => { const id = ++seq; jobs.set(id, { fn, ms }); return id; },
    cancel: (id) => jobs.delete(id),
    pending: () => [...jobs.values()].map((j) => j.ms),
    async run() {
      const [id, job] = [...jobs.entries()][0] || [];
      if (!id) return false;
      jobs.delete(id);
      await job.fn();
      return true;
    },
  };
}

// Real timers whose handle ignores unref(): the production code unrefs its
// timeout timer, but a test that awaits a hung push needs the loop kept alive.
const keepAliveTimers = {
  set: (fn, ms) => ({ h: setTimeout(fn, ms), unref() {} }),
  clear: (x) => clearTimeout(x.h),
};

function harness({ pushImpl, enabled = true, pushTimeout = 30 } = {}) {
  const clock = fakeClock();
  let state = initialState(show);
  const pushes = [];
  const statuses = [];
  const outbox = createOutbox({
    getState: () => state,
    push: pushImpl || (async (items) => { pushes.push(items); }),
    onStatus: (s) => statuses.push(s),
    now: () => '2026-10-22T23:00:00.000Z',
    schedule: clock.schedule, cancel: clock.cancel,
    minDelay: 1000, maxDelay: 30000, enabled, pushTimeout, timers: keepAliveTimers,
  });
  return {
    clock, outbox, pushes, statuses,
    change: (cmd) => { state = reduce(state, cmd, show); outbox.markDirty(); },
    get state() { return state; },
  };
}

test('markDirty schedules a flush and does not block', () => {
  const h = harness();
  h.change({ name: 'reveal' });
  assert.deepEqual(h.clock.pending(), [1000]);
  assert.equal(h.pushes.length, 0);
});

test('a flush pushes a full 39-match snapshot', async () => {
  const h = harness();
  h.change({ name: 'reveal' });
  await h.clock.run();
  assert.equal(h.pushes.length, 1);
  assert.equal(h.pushes[0].length, 39);
  assert.deepEqual(h.statuses.at(-1), { dirty: false, lastPushed: '2026-10-22T23:00:00.000Z', lastError: null });
});

test('many changes before the timer fires collapse into one push', async () => {
  const h = harness();
  h.change({ name: 'reveal' });
  h.change({ name: 'reveal' });
  h.change({ name: 'next' });
  assert.equal(h.clock.pending().length, 1);
  await h.clock.run();
  assert.equal(h.pushes.length, 1);
});

test('a failure backs off and keeps the pending flag up', async () => {
  let attempts = 0;
  const h = harness({ pushImpl: async () => { attempts += 1; throw new AwsError('pairings POST returned HTTP 503'); } });
  h.change({ name: 'reveal' });
  await h.clock.run();
  assert.equal(attempts, 1);
  assert.equal(h.statuses.at(-1).dirty, true);
  assert.equal(h.statuses.at(-1).lastError, 'pairings POST returned HTTP 503');
  assert.deepEqual(h.clock.pending(), [2000]);
  await h.clock.run();
  assert.deepEqual(h.clock.pending(), [4000]);
});

test('backoff is capped', async () => {
  const h = harness({ pushImpl: async () => { throw new Error('nope'); } });
  h.change({ name: 'reveal' });
  for (let i = 0; i < 12; i++) await h.clock.run();
  assert.deepEqual(h.clock.pending(), [30000]);
});

test('a success after failures resets the backoff', async () => {
  let fail = true;
  const h = harness({ pushImpl: async () => { if (fail) throw new Error('nope'); } });
  h.change({ name: 'reveal' });
  await h.clock.run();
  fail = false;
  await h.clock.run();
  assert.equal(h.statuses.at(-1).lastError, null);
  h.change({ name: 'reveal' });
  assert.deepEqual(h.clock.pending(), [1000]);
});

test('a change during a flush schedules another one', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const h = harness({ pushImpl: async () => { await gate; } });
  h.change({ name: 'reveal' });
  const running = h.clock.run();
  h.change({ name: 'reveal' });
  release();
  await running;
  assert.equal(h.statuses.at(-1).dirty, true);
  assert.deepEqual(h.clock.pending(), [1000]);
});

test('flushNow never rejects, however badly push misbehaves', async () => {
  const h = harness({ pushImpl: async () => { throw new Error('kaboom'); } });
  await assert.doesNotReject(() => h.outbox.flushNow());
  const h2 = harness({ pushImpl: () => { throw new Error('synchronous kaboom'); } });
  await assert.doesNotReject(() => h2.outbox.flushNow());
});

test('disabled, it never touches the network (rehearsal)', async () => {
  const h = harness({ enabled: false });
  h.change({ name: 'reveal' });
  await h.outbox.flushNow();
  assert.equal(h.pushes.length, 0);
  assert.deepEqual(h.clock.pending(), []);
});

test('stop cancels the pending flush', () => {
  const h = harness();
  h.change({ name: 'reveal' });
  h.outbox.stop();
  assert.deepEqual(h.clock.pending(), []);
});

test('loadPassword prefers the environment and never echoes the value', () => {
  assert.equal(loadPassword({ target: 'staging', env: { ICUP_ADMIN_PASSWORD: 's3cret' } }), 's3cret');
  try {
    loadPassword({ target: 'staging', env: {}, home: '/nowhere' });
    assert.fail('should have thrown');
  } catch (e) {
    assert.ok(e instanceof AwsError);
    assert.match(e.message, /staging-2026-08-20\.txt/);
  }
});

test('putPairings reports the status code and nothing else', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => { seen.push({ url, init }); return { ok: false, status: 401 }; };
  await assert.rejects(
    () => putPairings({ apiUrl: 'https://api.example/prod', password: 's3cret', items: [], fetchImpl }),
    (e) => e instanceof AwsError && e.message === 'pairings POST returned HTTP 401' && !e.message.includes('s3cret'),
  );
  assert.equal(seen[0].url, 'https://api.example/prod/pairings');
  assert.equal(seen[0].init.headers['x-admin-password'], 's3cret');
  assert.deepEqual(JSON.parse(seen[0].init.body), { pairings: [] });
});

// ---------------------------------------------------------------------------
// Beyond the brief.
// ---------------------------------------------------------------------------
const PW = 'invented-pw-7Qz!x9'; // invented; not a real credential
const leaks = (v) => JSON.stringify(v) + String(v && v.message) + String(v && v.stack);

test('API_URLS are the two known endpoints', () => {
  assert.equal(API_URLS.prod, 'https://qzq9gvuk9f.execute-api.us-east-1.amazonaws.com/prod');
  assert.equal(API_URLS.staging, 'https://9iz68mvngi.execute-api.us-east-1.amazonaws.com/prod');
});

test('loadPassword reads the right file for the target and names it when missing', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const home = mkdtempSync(join(tmpdir(), 'icup-'));
  mkdirSync(join(home, '.icup-admin-passwords'));
  writeFileSync(join(home, '.icup-admin-passwords', 'prod-2026-08-20.txt'), `${PW}\n`);
  assert.equal(loadPassword({ target: 'prod', env: {}, home }), PW);
  assert.throws(() => loadPassword({ target: 'staging', env: {}, home }),
    (e) => e instanceof AwsError && e.message.includes(join(home, '.icup-admin-passwords', 'staging-2026-08-20.txt')));
  assert.throws(() => loadPassword({ target: 'bogus', env: {}, home }), AwsError);
  assert.throws(() => loadPassword({ target: 'toString', env: {}, home }), AwsError);
});

test('password never escapes via a thrown error: fetch rejects, with the password in its own message', async () => {
  const fetchImpl = async (u, init) => { throw new Error(`connect failed ${init.headers['x-admin-password']}`); };
  await assert.rejects(
    () => putPairings({ apiUrl: 'https://api.example/prod', password: PW, items: [], fetchImpl }),
    (e) => e instanceof AwsError && !leaks(e).includes(PW),
  );
});

test('password never escapes via a 500 whose body echoes it', async () => {
  const fetchImpl = async (u, init) => ({
    ok: false, status: 500,
    json: async () => ({ error: PW, headers: init.headers }),
    text: async () => `echo: ${JSON.stringify(init.headers)}`,
  });
  await assert.rejects(
    () => putPairings({ apiUrl: 'https://api.example/prod', password: PW, items: [], fetchImpl }),
    (e) => e.message === 'pairings POST returned HTTP 500' && !leaks(e).includes(PW),
  );
  await assert.rejects(
    () => putPlayers({ apiUrl: 'https://api.example/prod', password: PW, players: [], fetchImpl }),
    (e) => e.message === 'players POST returned HTTP 500' && !leaks(e).includes(PW),
  );
});

test('password never reaches onStatus, in either failure mode or on success', async () => {
  const modes = {
    rejects: async (u, init) => { throw new Error(`boom ${init.headers['x-admin-password']}`); },
    echo500: async (u, init) => ({ ok: false, status: 500, json: async () => ({ e: init.headers['x-admin-password'] }) }),
    ok: async () => ({ ok: true, status: 200, json: async () => ({}) }),
  };
  for (const [name, fetchImpl] of Object.entries(modes)) {
    const h = harness({
      pushImpl: (items) => putPairings({ apiUrl: 'https://api.example/prod', password: PW, items, fetchImpl }),
    });
    h.change({ name: 'reveal' });
    await h.clock.run();
    await h.outbox.flushNow();
    assert.ok(h.statuses.length > 0, name);
    assert.ok(!JSON.stringify(h.statuses).includes(PW), `${name} leaked into onStatus`);
  }
});

test('even a non-AwsError that contains the password is not surfaced by the outbox', async () => {
  const h = harness({ pushImpl: async () => { throw new Error(`secret ${PW}`); } });
  h.change({ name: 'reveal' });
  await h.clock.run();
  assert.ok(!JSON.stringify(h.statuses).includes(PW));
});

test('GET helpers: unauthenticated, tolerate odd bodies, report status only', async () => {
  const seen = [];
  const ok = (body) => async (url, init) => { seen.push({ url, init }); return { ok: true, status: 200, json: async () => body }; };
  assert.deepEqual(await getPairings({ apiUrl: 'https://a/prod', fetchImpl: ok({ pairings: [{ id: 'x' }] }) }), [{ id: 'x' }]);
  assert.deepEqual(await getPairings({ apiUrl: 'https://a/prod', fetchImpl: ok({}) }), []);
  assert.deepEqual(await getPlayers({ apiUrl: 'https://a/prod', fetchImpl: ok({ players: [{ id: 'p' }] }) }), [{ id: 'p' }]);
  assert.equal(seen[0].url, 'https://a/prod/pairings');
  assert.equal(seen[2].url, 'https://a/prod/players');
  assert.ok(!seen.some((s) => s.init && s.init.headers && s.init.headers['x-admin-password']));
  await assert.rejects(() => getPairings({ apiUrl: 'https://a/prod', fetchImpl: async () => ({ ok: false, status: 503 }) }),
    (e) => e.message === 'pairings GET returned HTTP 503');
  await assert.rejects(() => getPairings({ apiUrl: 'https://a/prod', fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('x'); } }) }),
    (e) => e instanceof AwsError);
});

// ---- flushNow can never reject -------------------------------------------
const hostile = {
  'fetch throws synchronously': () => () => { throw new Error('sync'); },
  'fetch rejects asynchronously': () => async () => { throw new Error('async'); },
  'fetch returns a non-2xx': () => async () => ({ ok: false, status: 502, json: async () => { throw new Error('no'); } }),
  'fetch never settles': () => () => new Promise(() => {}),
  'fetch resolves undefined': () => async () => undefined,
};
for (const [name, make] of Object.entries(hostile)) {
  test(`flushNow resolves when ${name}`, async () => {
    const fetchImpl = make();
    const h = harness({ pushImpl: (items) => putPairings({ apiUrl: 'https://api.example/prod', password: PW, items, fetchImpl }) });
    h.change({ name: 'reveal' });
    let guard;
    const outcome = await Promise.race([
      h.outbox.flushNow().then(() => 'resolved', () => 'REJECTED'),
      new Promise((r) => { guard = setTimeout(() => r('HUNG'), 2000); }),
    ]);
    clearTimeout(guard);
    assert.equal(outcome, 'resolved');
    assert.equal(h.statuses.at(-1).dirty, true);
    assert.equal(typeof h.statuses.at(-1).lastError, 'string');
    assert.equal(h.outbox.pending(), true); // a retry is armed
  });
}

test('flushNow resolves when push, getState, onStatus and schedule all misbehave', async () => {
  const outbox = createOutbox({
    getState: () => { throw new Error('bad state'); },
    push: () => { throw new Error('x'); },
    onStatus: () => { throw new Error('bad listener'); },
    schedule: () => { throw new Error('bad scheduler'); },
    cancel: () => { throw new Error('bad cancel'); },
  });
  outbox.markDirty();
  await outbox.flushNow();
  outbox.stop();
});

test('a hung push is abandoned, counted as a failure, and a later flush proceeds', async () => {
  let calls = 0;
  const h = harness({ pushImpl: () => { calls += 1; return calls === 1 ? new Promise(() => {}) : Promise.resolve(); } });
  h.change({ name: 'reveal' });
  await h.outbox.flushNow();
  assert.equal(h.statuses.at(-1).lastError, 'push timed out');
  await h.clock.run();
  assert.equal(calls, 2);
  assert.equal(h.statuses.at(-1).lastError, null);
});

// ---- markDirty is synchronous and the latest state always lands ------------
test('markDirty returns synchronously even while a flush is in flight', async () => {
  const h = harness({ pushImpl: () => new Promise(() => {}) });
  h.change({ name: 'reveal' });
  const running = h.clock.run();
  const t0 = process.hrtime.bigint();
  const ret = h.outbox.markDirty();
  assert.equal(ret, undefined);
  assert.ok(Number(process.hrtime.bigint() - t0) / 1e6 < 20);
  await running;
});

test('a markDirty during a flush yields a second push carrying the NEWER state', async () => {
  const pushes = [];
  let release;
  const gate = new Promise((r) => { release = r; });
  let first = true;
  const h = harness({
    pushImpl: async (items) => {
      pushes.push(items);
      if (first) { first = false; await gate; }
    },
  });
  h.change({ name: 'reveal' });
  const running = h.clock.run();
  await Promise.resolve();
  assert.equal(pushes.length, 1);
  const before = JSON.stringify(pushes[0]);
  // Mid-flight: state changes, markDirty is called.
  h.change({ name: 'reveal' });
  h.change({ name: 'next' });
  h.change({ name: 'reveal' });
  const expected = JSON.stringify(toPairingItems(h.state));
  assert.notEqual(expected, before);
  release();
  await running;
  assert.equal(h.statuses.at(-1).dirty, true);
  assert.equal(await h.clock.run(), true);
  assert.equal(pushes.length, 2);
  assert.equal(JSON.stringify(pushes[1]), expected);
  assert.notEqual(JSON.stringify(pushes[1]), JSON.stringify(pushes[0]));
});

test('markDirty during a flush that then FAILS is not lost either', async () => {
  let n = 0;
  let release;
  const gate = new Promise((r) => { release = r; });
  const h = harness({ pushImpl: async () => { n += 1; if (n === 1) { await gate; throw new AwsError('pairings POST returned HTTP 503'); } } });
  h.change({ name: 'reveal' });
  const running = h.clock.run();
  h.change({ name: 'reveal' });
  release();
  await running;
  assert.equal(h.outbox.pending(), true);
  await h.clock.run();
  assert.equal(n, 2);
  assert.equal(h.statuses.at(-1).dirty, false);
});

test('flushNow during an in-flight flush does not resolve until that push has landed', async () => {
  let n = 0;
  let release;
  const gate = new Promise((r) => { release = r; });
  const h = harness({ pushImpl: async () => { n += 1; await gate; }, pushTimeout: 5000 });
  const first = h.outbox.flushNow();
  let landed = false;
  const second = h.outbox.flushNow().then(() => { assert.equal(landed, true, 'resolved before the push landed'); });
  await new Promise((r) => setTimeout(r, 20));
  landed = true;
  release();
  await Promise.all([first, second]);
  assert.equal(n, 1); // nothing newer, so no double push
});

test('flushNow during an in-flight flush then pushes once more if state moved on, and never rejects', async () => {
  const pushes = [];
  let release;
  const gate = new Promise((r) => { release = r; });
  const h = harness({ pushImpl: async (items) => { pushes.push(items); if (pushes.length === 1) await gate; }, pushTimeout: 5000 });
  h.change({ name: 'reveal' });
  const first = h.outbox.flushNow();
  await Promise.resolve();
  h.change({ name: 'reveal' });
  const second = h.outbox.flushNow();
  release();
  await Promise.all([first, second]);
  assert.equal(pushes.length, 2);
  assert.equal(JSON.stringify(pushes[1]), JSON.stringify(toPairingItems(h.state)));
  assert.equal(h.statuses.at(-1).dirty, false);
});

test('flushNow during an in-flight flush that fails still resolves', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const h = harness({ pushImpl: async () => { await gate; throw new AwsError('pairings POST returned HTTP 503'); }, pushTimeout: 5000 });
  const first = h.outbox.flushNow();
  const second = h.outbox.flushNow();
  release();
  await assert.doesNotReject(() => Promise.all([first, second]));
});

test('timer path: a hostile error object cannot produce an unhandled rejection', async () => {
  const hostileErr = {};
  for (const k of ['name', 'message']) Object.defineProperty(hostileErr, k, { get() { throw new Error('getter'); } });
  const seen = [];
  const onUnhandled = (e) => seen.push(e);
  process.on('unhandledRejection', onUnhandled);
  try {
    const h = harness({ pushImpl: async () => { throw hostileErr; } });
    h.change({ name: 'reveal' });
    await h.clock.run();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(seen, []);
    assert.equal(h.statuses.at(-1).lastError, 'push failed');
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

test('a throwing onStatus on the timer path is not an unhandled rejection', async () => {
  const seen = [];
  const onUnhandled = (e) => seen.push(e);
  process.on('unhandledRejection', onUnhandled);
  try {
    const clock = fakeClock();
    const outbox = createOutbox({
      getState: () => initialState(show), push: async () => {}, onStatus: () => { throw new Error('listener'); },
      schedule: clock.schedule, cancel: clock.cancel, pushTimeout: 30,
    });
    outbox.markDirty();
    await clock.run();
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(seen, []);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

// WHAT THE report() GUARD ACTUALLY BUYS (F6/F7): report() is called one line
// before arm(), so a throwing onStatus without it would skip the retry and the
// outbox would stop pushing for the rest of the night, in silence. (It is not
// what prevents an unhandled rejection - the test above pins that separately.)
test('a throwing onStatus does not stop the outbox retrying', async () => {
  const clock = fakeClock();
  const pushes = [];
  const outbox = createOutbox({
    getState: () => initialState(show),
    push: async () => { pushes.push(1); if (pushes.length === 1) throw new Error('website down'); },
    onStatus: () => { throw new Error('the console handed us a listener that throws'); },
    schedule: clock.schedule, cancel: clock.cancel, minDelay: 1000, pushTimeout: 30, timers: keepAliveTimers,
  });
  outbox.markDirty();
  await clock.run();                                  // the push fails; onStatus throws on the way out
  assert.equal(pushes.length, 1);
  assert.deepEqual(clock.pending(), [2000], 'the retry is still armed');
  await clock.run();                                  // and it really fires
  assert.equal(pushes.length, 2);
});

test('stop clears the push timeout, abandons the hung push promptly, and says nothing afterwards', async () => {
  const h = harness({ pushImpl: () => new Promise(() => {}), pushTimeout: 1500 });
  h.change({ name: 'reveal' });
  const running = h.clock.run();
  await Promise.resolve();
  const before = h.statuses.length;
  h.outbox.stop();
  const outcome = await Promise.race([running.then(() => 'settled'), new Promise((r) => setTimeout(() => r('STILL WAITING'), 300))]);
  assert.equal(outcome, 'settled');
  assert.equal(h.statuses.length, before);
  assert.equal(h.outbox.pending(), false);
  assert.deepEqual(h.clock.pending(), []);
});

test('stop during a push that later succeeds does not call onStatus', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const h = harness({ pushImpl: async () => { await gate; }, pushTimeout: 5000 });
  h.change({ name: 'reveal' });
  const running = h.clock.run();
  await Promise.resolve();
  h.outbox.stop();
  release();
  await running;
  assert.deepEqual(h.statuses, []);
});

test('flushNow cancels the timer it supersedes, so there is no redundant push', async () => {
  const h = harness();
  h.change({ name: 'reveal' });
  await h.outbox.flushNow();
  assert.equal(h.pushes.length, 1);
  assert.deepEqual(h.clock.pending(), []);
});

test('after stop, nothing is scheduled or pushed', async () => {
  const h = harness();
  h.outbox.stop();
  h.change({ name: 'reveal' });
  await h.outbox.flushNow();
  assert.deepEqual(h.clock.pending(), []);
  assert.equal(h.pushes.length, 0);
});

test('a 200 whose body is not JSON resolves flushNow (the POST body is never read) and counts as success', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); }, text: async () => '<html>' });
  const h = harness({ pushImpl: (items) => putPairings({ apiUrl: 'https://api.example/prod', password: PW, items, fetchImpl }) });
  h.change({ name: 'reveal' });
  await assert.doesNotReject(() => h.outbox.flushNow());
  assert.equal(h.statuses.at(-1).lastError, null);
});

test('markDirty after a failure schedules at the backed-off delay, not minDelay', async () => {
  let fail = true;
  const h = harness({ pushImpl: async () => { if (fail) throw new Error('x'); } });
  h.change({ name: 'reveal' });
  await h.clock.run(); // fails; retry armed at 2000
  assert.deepEqual(h.clock.pending(), [2000]);
  h.change({ name: 'next' }); // timer already armed: must not add or shorten
  assert.deepEqual(h.clock.pending(), [2000]);
  fail = false;
  await h.clock.run();
  assert.equal(h.statuses.at(-1).lastError, null);
});

test('the push-timeout timer is unref\'d, and stop() clears exactly that handle', async () => {
  const log = { set: [], cleared: [], unref: [] };
  const timers = {
    set: (fn, ms) => { const h = { id: log.set.length, unref() { log.unref.push(this.id); } }; log.set.push({ h, ms }); return h; },
    clear: (h) => log.cleared.push(h),
  };
  const outbox = createOutbox({
    getState: () => initialState(show), push: () => new Promise(() => {}),
    schedule: () => 1, cancel: () => {}, pushTimeout: 4321, timers,
  });
  const running = outbox.flushNow();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(log.set.length, 1);
  assert.equal(log.set[0].ms, 4321);
  assert.deepEqual(log.unref, [0], 'timeout timer must be unref\'d');
  assert.equal(log.cleared.length, 0);
  outbox.stop();
  await running;
  assert.deepEqual(log.cleared, [log.set[0].h], 'stop() must clear the timeout handle');
});

test('a completed push clears its timeout handle too', async () => {
  const cleared = [];
  const handles = [];
  const timers = { set: () => { const h = { unref() {} }; handles.push(h); return h; }, clear: (h) => cleared.push(h) };
  const outbox = createOutbox({ getState: () => initialState(show), push: async () => {}, schedule: () => 1, cancel: () => {}, timers });
  await outbox.flushNow();
  assert.deepEqual(cleared, handles);
});
