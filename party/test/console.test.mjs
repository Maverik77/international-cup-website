// The sync clock shows the operator's local time, so the brief's expected
// 23:41:02 only holds in UTC. Pin it, or the test depends on the laptop's zone.
process.env.TZ = 'UTC';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rosterFor, nameOf, syncLabel, describeProblems, slotLabel, createCommandClient } from '../public/console.mjs';
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
