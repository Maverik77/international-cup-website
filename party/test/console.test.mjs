// The sync clock shows the operator's local time, so the brief's expected
// 23:41:02 only holds in UTC. Pin it, or the test depends on the laptop's zone.
process.env.TZ = 'UTC';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rosterFor, nameOf, syncLabel, describeProblems, slotLabel, createCommandClient, matchCount, recoveredBanner, loadUntilReady, LOGIN_PATH, NEXT_FLIGHT_CAP_MS } from '../public/console.mjs';
import { indexShow } from '../build/build-show.mjs';

const players = [
  { id: 'player-intl-1', team: 'international', name: 'Ashvini Anjutgi', country: 'India' },
  { id: 'player-intl-2', team: 'international', name: 'Alba Phillips', country: 'Spain' },
  { id: 'player-usa-1', team: 'usa', name: 'John Altman', country: 'USA' },
  { id: 'player-usa-2', team: 'usa', name: 'Frank Ambrose', country: 'USA' },
];
const show = indexShow({ built: 'now', players, days: { 1: [], 2: [] } });
// What the browser really has: /api/show parsed from JSON, with no byId.
const plain = JSON.parse(JSON.stringify(show));

test('each side lists only its own players, by surname', () => {
  assert.deepEqual(rosterFor(show, 'intl').map((p) => p.name), ['Ashvini Anjutgi', 'Alba Phillips']);
  assert.deepEqual(rosterFor(show, 'usa').map((p) => p.name), ['John Altman', 'Frank Ambrose']);
});

test('nameOf copes with a blank or unknown id', () => {
  assert.equal(nameOf(show, 'player-usa-1'), 'John Altman');
  assert.equal(nameOf(show, ''), '');
  assert.equal(nameOf(show, 'ghost'), 'ghost');
});

test('the sync indicator says whether AWS has what is on screen', () => {
  assert.deepEqual(syncLabel({ dirty: false, lastPushed: '2026-10-22T23:41:02.000Z', lastError: null }),
    { text: 'Synced 23:41:02', tone: 'ok' });
  assert.deepEqual(syncLabel({ dirty: true, lastPushed: null, lastError: null }),
    { text: 'Syncing…', tone: 'pending' });
  assert.deepEqual(syncLabel({ dirty: true, lastPushed: '2026-10-22T23:38:10.000Z', lastError: 'pairings POST returned HTTP 503' }),
    { text: 'Offline — last synced 23:38:10', tone: 'offline' });
  assert.deepEqual(syncLabel({ dirty: true, lastPushed: null, lastError: 'ENOTFOUND' }),
    { text: 'Offline — never synced', tone: 'offline' });
  assert.deepEqual(syncLabel({ dirty: false, lastPushed: null, lastError: null }),
    { text: 'Sync off', tone: 'ok' });
});

// REVIEW FOCUS 5: the operator must read a name, not a player id, under pressure.
test('problems are reported with names', () => {
  assert.deepEqual(
    describeProblems(['player-usa-1 appears twice in this match', 'player-usa-2 is already in match 4'], show),
    ['John Altman appears twice in this match', 'Frank Ambrose is already in match 4'],
  );
});

// The browser's show has no byId: JSON drops the hub's non-enumerable index.
test('names still come through on a show parsed from JSON', () => {
  assert.equal(plain.byId, undefined);
  assert.equal(nameOf(plain, 'player-usa-1'), 'John Altman');
  assert.deepEqual(
    describeProblems(['player-usa-1 appears twice in this match'], plain),
    ['John Altman appears twice in this match'],
  );
});

test('the slot label says where you are', () => {
  assert.equal(slotLabel({ day: 1, slot: { index: 3 } }), 'Day 1 · Match 3 of 13');
  assert.equal(slotLabel({ day: 2, slot: { index: 26 } }), 'Day 2 · Match 26 of 26');
});

// A fake hub endpoint: answers each fetch with the next scripted reply.
function harness(replies, nowRef = { t: 1000 }) {
  const sent = [];
  const states = [];
  const logins = [];
  const fetch = async (_url, init) => {
    sent.push(JSON.parse(init.body));
    const r = typeof replies === 'function' ? replies(sent.length) : replies.shift();
    if (r instanceof Error) throw r;
    return { status: r.status, json: async () => r.body };
  };
  const client = createCommandClient({
    fetch, now: () => nowRef.t,
    onState: (s) => states.push(s), onLogin: () => logins.push(true),
  });
  return { client, sent, states, logins, nowRef };
}
const OK = { status: 200, body: { ok: true, state: { rev: 2 } } };

test('two Next taps in quick succession advance exactly one match', async () => {
  const h = harness(() => OK);
  const [a, b] = await Promise.all([h.client.send({ name: 'next' }), h.client.send({ name: 'next' })]);
  assert.equal(a.kind, 'ok');
  assert.equal(b.kind, 'ignored');
  assert.equal((await h.client.send({ name: 'next' })).kind, 'ignored');   // still inside the window, request done
  assert.equal(h.sent.filter((c) => c.name === 'next').length, 1);
  assert.equal(h.client.nextLocked(), true);
  h.nowRef.t += 2000;                                                      // the window closes
  assert.equal(h.client.nextLocked(), false);
  assert.equal((await h.client.send({ name: 'next' })).kind, 'ok');
  assert.equal(h.sent.filter((c) => c.name === 'next').length, 2);
});

test('a refused Next does not lock the button, and other commands are never held', async () => {
  const h = harness([
    { status: 400, body: { ok: false, error: 'Day 2: that was the last match. Use Undo, or pick another match.' } },
    OK, OK, OK,
  ]);
  const first = await h.client.send({ name: 'next' });
  assert.deepEqual(first, { kind: 'note', message: 'Day 2: that was the last match. Use Undo, or pick another match.' });
  assert.equal(h.client.nextLocked(), false);
  assert.equal((await h.client.send({ name: 'next' })).kind, 'ok');
  assert.equal((await h.client.send({ name: 'reveal' })).kind, 'ok');
  assert.equal((await h.client.send({ name: 'reveal' })).kind, 'ok');
});

test('a 400 is a quiet note, shown as the hub wrote it', async () => {
  const h = harness([{ status: 400, body: { ok: false, error: 'Nothing to undo.' } }]);
  assert.deepEqual(await h.client.send({ name: 'undo' }), { kind: 'note', message: 'Nothing to undo.' });
  assert.deepEqual(h.states, []);
});

test('a 500 and a lost connection are faults; a 502 is a note', async () => {
  const h = harness([
    { status: 500, body: { ok: false, error: 'The hub hit a fault.' } },
    new Error('network down'),
    { status: 502, body: { ok: false, error: 'The website could not be reached.' } },
  ]);
  assert.equal((await h.client.send({ name: 'reveal' })).kind, 'fault');
  assert.equal((await h.client.send({ name: 'reveal' })).kind, 'fault');
  assert.deepEqual(await h.client.send({ name: 'refreshFromAws' }), { kind: 'note', message: 'The website could not be reached.' });
});

test('a 401 needPassword sends the console to /operator and is not an error note', async () => {
  const h = harness([{ status: 401, body: { ok: false, needPassword: true, error: 'Enter the password.' } }]);
  const out = await h.client.send({ name: 'reveal' });
  assert.deepEqual(out, { kind: 'login' });          // no message for the page to show
  assert.deepEqual(h.logins, [true]);
  assert.deepEqual(h.states, []);
});

test('an accepted command hands the new state to the page', async () => {
  const h = harness([OK]);
  await h.client.send({ name: 'reveal' });
  assert.deepEqual(h.states, [{ rev: 2 }]);
});

// A hub that answers only when the test says so: models a slow wifi round trip.
function slowHarness() {
  const sent = [];
  const nowRef = { t: 1000 };
  const pending = [];
  const fetch = (_u, init) => {
    sent.push(JSON.parse(init.body));
    return new Promise((resolve) => { pending.push(() => resolve({ status: 200, json: async () => OK.body })); });
  };
  const client = createCommandClient({ fetch, now: () => nowRef.t, onState() {}, onLogin() {} });
  // Answer everything still waiting. Tests call this in a finally so no request
  // outlives its test, and one failure stays one failure.
  return { client, sent, nowRef, release: () => { while (pending.length) pending.shift()(); } };
}

test('a Next tap after the lock window, while the first is still unanswered, sends nothing', async () => {
  const h = slowHarness();
  const first = h.client.send({ name: 'next' });
  try {
    h.nowRef.t += 1600;                                 // past the 1.5 s window, hub still silent
    assert.equal(h.client.nextLocked(), true);
    // If the guard is broken this send goes out and waits on the silent hub; do
    // not wait with it, or the test hangs instead of failing.
    const second = await Promise.race([h.client.send({ name: 'next' }), new Promise((r) => setImmediate(() => r('still waiting')))]);
    assert.deepEqual(second, { kind: 'ignored' });
    assert.equal(h.sent.length, 1);
    h.release();
    assert.equal((await first).kind, 'ok');
    h.nowRef.t += 2000;
    assert.equal(h.client.nextLocked(), false);
  } finally { h.release(); }
});

test('a hung Next cannot strand the operator forever', async () => {
  const h = slowHarness();
  const first = h.client.send({ name: 'next' });        // not answered yet
  try {
    h.nowRef.t += NEXT_FLIGHT_CAP_MS + 1;
    assert.equal(h.client.nextLocked(), false);
    const second = h.client.send({ name: 'next' });
    assert.equal(h.sent.length, 2);
    h.release();
    await Promise.all([first, second]);
  } finally { h.release(); }
});

test('any 401, with or without a body, goes to login; a null reply is a note, not a throw', async () => {
  const h = harness([
    { status: 401, body: null },
    { status: 401, body: { ok: false, error: 'x' } },
    { status: 200, body: null },
  ]);
  assert.deepEqual(await h.client.send({ name: 'reveal' }), { kind: 'login' });
  assert.deepEqual(await h.client.send({ name: 'reveal' }), { kind: 'login' });
  assert.equal(h.logins.length, 2);
  assert.equal((await h.client.send({ name: 'next' })).kind, 'note');
  assert.equal(h.client.nextLocked(), false);           // refused: nothing moved, nothing held
  assert.equal(LOGIN_PATH, '/operator');
});

test('the console keeps trying to load until it succeeds, and clears the fault', async () => {
  let calls = 0;
  const events = [];
  const out = await loadUntilReady({
    load: async () => { calls += 1; if (calls === 1) throw new Error('hub restarting'); return { ok: calls }; },
    onReady: () => events.push('ready'),
    onFail: () => events.push('fail'),
    wait: async () => { events.push('wait'); },
  });
  assert.deepEqual(events, ['fail', 'wait', 'ready']);
  assert.deepEqual(out, { ok: 2 });
});

test('both days know their match count', () => {
  assert.equal(matchCount(1), 13);
  assert.equal(matchCount(2), 26);
});

const LEAKY = {
  recovered: true,
  recoveredSummary: 'The saved show state was unusable, so the show started fresh: bad JSON, probably cut off mid-save.',
  recoveredReason: "The saved show state was unusable, so the show started fresh: bad JSON, probably cut off mid-save (Unexpected token 'h') . The old file was kept as /tmp/x/state.json.corrupt-2026 (EACCES)",
};

test('a recovered start is announced with its summary and the way back; a normal start says nothing', () => {
  const text = recoveredBanner(LEAKY);
  assert.match(text, /started over from Day 1, match 1/);
  assert.ok(text.includes(LEAKY.recoveredSummary));
  assert.match(text, /Jump to/);
  assert.equal(recoveredBanner({ recovered: false, recoveredSummary: null }), null);
  assert.equal(recoveredBanner(undefined), null);
});

test('the banner never carries the terminal detail: no path, no parse error, not even as a fallback', () => {
  for (const who of [LEAKY, { ...LEAKY, recoveredSummary: null }]) {
    const text = recoveredBanner(who);
    for (const leak of ['/tmp/x', 'state.json', '.corrupt-', 'Unexpected token', 'EACCES']) {
      assert.equal(text.includes(leak), false, `banner leaked ${leak}`);
    }
  }
  assert.match(recoveredBanner({ ...LEAKY, recoveredSummary: null }), /^The show started over from Day 1, match 1\. If you were/);
});
