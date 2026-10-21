// The sync clock shows the operator's local time, so the brief's expected
// 23:41:02 only holds in UTC. Pin it, or the test depends on the laptop's zone.
process.env.TZ = 'UTC';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rosterFor, nameOf, syncLabel, describeProblems, slotLabel, createCommandClient, matchCount, recoveredBanner, loadUntilReady, LOGIN_PATH, NEXT_FLIGHT_CAP_MS, takenOnDay, pickerRows, matchNames, jumpSections, screenRows, screensInSync, screensLabel, SCREEN_ROLE_LABELS, SCREEN_ROLE_HINTS, screenRoleChoices, filmSections } from '../public/console.mjs';
import { SCREEN_ROLES } from '../public/panels.mjs';
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

// A SETTLED DECISION, PINNED: a Next that never reached the hub reopens the
// lock. The operator in the pub has no way to know whether it landed, so the
// button has to be theirs again at once; the alternative is standing there with
// a dead button for the rest of the lock window.
test('a Next that could not be sent leaves the button open, not locked', async () => {
  const h = harness([new Error('wifi dropped'), OK]);
  const out = await h.client.send({ name: 'next' });
  assert.equal(out.kind, 'fault');
  assert.equal(h.client.nextLocked(), false, 'the lock reopened: the Next may never have arrived');
  assert.equal((await h.client.send({ name: 'next' })).kind, 'ok', 'and the operator can try again at once');
  assert.equal(h.sent.filter((c) => c.name === 'next').length, 2);
  // ...and that retry does take the lock, so the reopen is not a lost lock
  assert.equal(h.client.nextLocked(), true);
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
    return new Promise((resolve) => { pending.push((r = OK) => resolve({ status: r.status, json: async () => r.body })); });
  };
  const client = createCommandClient({ fetch, now: () => nowRef.t, onState() {}, onLogin() {} });
  // Answer everything still waiting. Tests call this in a finally so no request
  // outlives its test, and one failure stays one failure.
  return { client, sent, nowRef, release: Object.assign(() => { while (pending.length) pending.shift()(); }, { first: (reply) => pending.shift()(reply) }) };
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

test('a late reply to a hung Next cannot reopen the lock a newer Next holds', async () => {
  const h = slowHarness();
  const first = h.client.send({ name: 'next' });          // hangs
  try {
    h.nowRef.t += NEXT_FLIGHT_CAP_MS + 1;                 // the cap frees the lock
    const second = h.client.send({ name: 'next' });       // a deliberate second tap, also unanswered
    assert.equal(h.sent.length, 2);
    assert.equal(h.client.nextLocked(), true);
    h.nowRef.t += 2000;                                   // the second Next's own window is over, its cap is not
    h.release.first({ status: 400, body: { ok: false, error: 'late refusal' } });   // only the FIRST reply arrives, late
    await first;
    assert.equal(h.client.nextLocked(), true, 'the first reply must not free the second Next');
    const third = await Promise.race([h.client.send({ name: 'next' }), new Promise((r) => setImmediate(() => r('still waiting')))]);
    assert.deepEqual(third, { kind: 'ignored' });
    assert.equal(h.sent.length, 2);
    h.release();
    await second;
  } finally { h.release(); }
});

// --- the picker, and the Jump list over both days ----------------------------

// Four players a side is enough to say everything: one drawn elsewhere on this
// day, one drawn on the other day, one in the slot being edited, one free.
const big = indexShow({ built: 'now', days: { 1: [], 2: [] }, players: [
  { id: 'i1', team: 'international', name: 'Ashvini Anjutgi' },
  { id: 'i2', team: 'international', name: 'Vijay Davuluri' },
  { id: 'i3', team: 'international', name: 'Jun Bae' },
  { id: 'i4', team: 'international', name: 'Yun Sang Bae' },
  { id: 'u1', team: 'usa', name: 'John Altman' },
  { id: 'u2', team: 'usa', name: 'Frank Ambrose' },
] });

const board = {
  day: 1,
  current: { 1: 0, 2: 0 },
  days: {
    1: [{ index: 1, intl: ['i1', ''], usa: ['u1', ''], done: false },
      { index: 2, intl: ['i2', 'i3'], usa: ['', ''], done: true }],
    2: [{ index: 1, intl: ['i4'], usa: [''], done: false },
      { index: 2, intl: [''], usa: [''], done: false }],
  },
};

const names = (r) => r.rows.map((x) => x.name);

test('a player drawn anywhere on this day is off the list, and the toggle counts them', () => {
  const hidden = pickerRows(big, { side: 'intl', board, day: 1, current: 1 });
  assert.deepEqual(names(hidden), ['Yun Sang Bae'], 'only the one not drawn on day 1');
  assert.equal(hidden.hidden, 3);

  const shown = pickerRows(big, { side: 'intl', board, day: 1, current: 1, showPicked: true });
  assert.deepEqual(names(shown), ['Ashvini Anjutgi', 'Jun Bae', 'Yun Sang Bae', 'Vijay Davuluri']);
  assert.equal(shown.hidden, 0, 'nothing is hidden once they are shown');
  assert.deepEqual(shown.rows.map((x) => x.where),
    ['already in this match', 'already in match 2', '', 'already in match 2']);
});

// Each day draws all 26 a side, so a night-wide rule empties the list on day 2.
test('being drawn on the other day does not take a player off this day', () => {
  assert.ok(names(pickerRows(big, { side: 'intl', board, day: 2 })).includes('Ashvini Anjutgi'),
    'day 1 holds i1, but we are picking for day 2');
  assert.deepEqual(takenOnDay(board, 1), new Map([['i1', 1], ['u1', 1], ['i2', 2], ['i3', 2]]));
  assert.deepEqual(takenOnDay(board, 2), new Map([['i4', 1]]));
});

test('whoever is in the slot being edited stays on the list, so they can be replaced', () => {
  const r = pickerRows(big, { side: 'intl', board, day: 1, current: 1, holding: 'i1' });
  assert.ok(names(r).includes('Ashvini Anjutgi'), 'the slot\'s own player is never hidden');
  assert.equal(r.rows.find((x) => x.id === 'i1').holding, true);
  assert.equal(r.rows.find((x) => x.id === 'i1').picked, false);
  assert.equal(r.hidden, 2, 'the other two drawn players are still hidden');
});

test('the search box and the picked rule both apply, in that order', () => {
  assert.deepEqual(names(pickerRows(big, { side: 'intl', board, day: 1, query: 'bae', showPicked: true })),
    ['Jun Bae', 'Yun Sang Bae']);
  assert.deepEqual(names(pickerRows(big, { side: 'intl', board, day: 1, query: 'bae' })), ['Yun Sang Bae']);
  assert.equal(pickerRows(big, { side: 'intl', board, day: 1, query: 'bae' }).hidden, 1,
    'the count is of what this search hid, not of the whole roster');
  assert.deepEqual(names(pickerRows(big, { side: 'intl', board, day: 1, query: 'zzz', showPicked: true })), []);
});

test('with no board nothing is hidden, so a console that cannot fetch one still picks', () => {
  for (const b of [null, undefined, {}, { days: null }, { days: { 1: 'nope' } }, 'x']) {
    const r = pickerRows(big, { side: 'intl', board: b, day: 1 });
    assert.equal(r.rows.length, 4, JSON.stringify(b));
    assert.equal(r.hidden, 0);
  }
  assert.deepEqual(takenOnDay(null, 1), new Map());
  assert.deepEqual(takenOnDay({ days: { 1: [null, 'x', { intl: 'no', usa: 7 }] } }, 1), new Map());
});

test('the Jump list reads out who is already in each match, on both days', () => {
  const [d1, d2] = jumpSections(big, board);
  assert.equal(d1.title, 'Day 1');
  assert.equal(d2.title, 'Day 2');
  assert.deepEqual(d1.rows.map((r) => r.label), ['Match 1', 'Match 2']);
  assert.deepEqual(d1.rows.map((r) => r.names), [
    'Ashvini Anjutgi vs John Altman',
    'Vijay Davuluri + Jun Bae vs —',
  ]);
  assert.deepEqual(d2.rows.map((r) => r.names), ['Yun Sang Bae vs —', '']);
  // index is what the command takes (from 0); label is what the operator reads.
  assert.deepEqual(d1.rows.map((r) => r.index), [0, 1]);
  assert.deepEqual(d1.rows.map((r) => r.day), [1, 1]);
  assert.deepEqual(d2.rows.map((r) => r.day), [2, 2]);
  assert.deepEqual(d1.rows.map((r) => r.done), [false, true]);
  // Exactly one row is where the operator is standing, and it is on the day in play.
  const here = [...d1.rows, ...d2.rows].filter((r) => r.current);
  assert.deepEqual(here, [d1.rows[0]]);
});

test('a match nobody is drawn into reads as empty, not as a row of dashes', () => {
  assert.equal(matchNames(big, { intl: ['', ''], usa: ['', ''] }), '');
  assert.equal(matchNames(big, {}), '');
  assert.equal(matchNames(big, null), '');
  assert.equal(matchNames(big, { intl: ['i1'], usa: [] }), 'Ashvini Anjutgi vs —');
  // Full names: this roster has two Baes, so a surname names nobody.
  assert.equal(matchNames(big, { intl: ['i3', 'i4'], usa: ['u1', 'u2'] }),
    'Jun Bae + Yun Sang Bae vs John Altman + Frank Ambrose');
});

test('a board the console cannot make sense of still opens the Jump list', () => {
  for (const b of [null, undefined, {}, { days: {} }, 'x', { days: { 1: null, 2: null } }]) {
    const s = jumpSections(big, b);
    assert.equal(s.length, 2, JSON.stringify(b));
    assert.deepEqual(s.map((x) => x.title), ['Day 1', 'Day 2']);
    assert.deepEqual(s.map((x) => x.rows.length), [0, 0]);
  }
  // A match with no index of its own is still numbered by where it sits.
  assert.equal(jumpSections(big, { days: { 1: [{}] } })[0].rows[0].label, 'Match 1');
});

// --- the Screens dialog ------------------------------------------------------

test('every role the stage understands has words on a button', () => {
  for (const role of SCREEN_ROLES) {
    assert.equal(typeof SCREEN_ROLE_LABELS[role], 'string', role);
    assert.ok(SCREEN_ROLE_LABELS[role].length > 0, role);
    assert.ok(SCREEN_ROLE_HINTS[role].length > 0, role);
  }
  // And nothing is labelled that the stage would not accept.
  assert.deepEqual(Object.keys(SCREEN_ROLE_LABELS).sort(), [...SCREEN_ROLES].sort());
});

test('the refusal the hub sends back names every role, in the order of the buttons', () => {
  const sentence = screenRoleChoices();
  for (const role of SCREEN_ROLES) assert.ok(sentence.includes(SCREEN_ROLE_LABELS[role]), role);
  assert.equal(sentence, 'Mirror the show, Slideshow, Player films, Photos of years gone by, Draw so far or Title card');
  assert.equal(sentence.includes(','), SCREEN_ROLES.length > 2);
});

test('the main screen is listed first, the rest by name', () => {
  const rows = screenRows({ screens: { zed: 'hold', bar: 'slideshow', main: 'mirror', alpha: 'list' } });
  assert.deepEqual(rows.map((r) => r.name), ['main', 'alpha', 'bar', 'zed']);
  assert.deepEqual(rows.map((r) => r.label), ['Main screen', 'alpha', 'bar', 'zed']);
  assert.deepEqual(rows.map((r) => r.role), ['mirror', 'list', 'slideshow', 'hold']);
  // Every row offers every role, so the dialog never depends on what is set now.
  assert.deepEqual(rows[0].roles.map((r) => r.role), SCREEN_ROLES);
});

test('a role the console does not recognise reads as mirror rather than a blank button', () => {
  const rows = screenRows({ screens: { main: 'nonsense', bar: null } });
  assert.deepEqual(rows.map((r) => r.role), ['mirror', 'mirror']);
  for (const junk of [null, undefined, {}, { screens: null }, { screens: 'x' }, 'x']) {
    assert.deepEqual(screenRows(junk), [], JSON.stringify(junk));
    assert.equal(screensInSync(junk), true, 'nothing listed is nothing out of step');
    assert.equal(screensLabel(junk), 'Screens…');
  }
});

test('the console says when a screen has wandered off the show', () => {
  assert.equal(screensInSync({ screens: { main: 'mirror', bar: 'mirror' } }), true);
  assert.equal(screensLabel({ screens: { main: 'mirror', bar: 'mirror' } }), 'Screens…');
  assert.equal(screensInSync({ screens: { main: 'mirror', bar: 'slideshow' } }), false);
  assert.equal(screensLabel({ screens: { main: 'mirror', bar: 'slideshow' } }), 'Screens… (1 off the show)');
  assert.equal(screensLabel({ screens: { main: 'hold', bar: 'list', c: 'mirror' } }), 'Screens… (2 off the show)');
});

// --- Jump to a film ----------------------------------------------------------

// Films hang off the same four players, so the list can be checked against a
// known order. Anjutgi and Altman have one; Phillips and Ambrose do not.
const filmShow = indexShow({
  built: 'now',
  days: { 1: [], 2: [] },
  players: players.map((p) => (p.id === 'player-intl-1' || p.id === 'player-usa-1'
    ? { ...p, film: `cards/${p.id}-16x9-web.mp4` }
    : p)),
});

test('the film list is the players who have one, by side and then by surname', () => {
  const sections = filmSections(filmShow);
  assert.deepEqual(sections.map((s) => s.title), ['International', 'USA']);
  assert.deepEqual(sections[0].rows.map((r) => r.name), ['Ashvini Anjutgi']);
  assert.deepEqual(sections[1].rows.map((r) => r.name), ['John Altman']);
  // A player with no film is not on the list at all: there is nothing to play.
  const all = sections.flatMap((s) => s.rows.map((r) => r.playerId));
  assert.deepEqual(all, ['player-intl-1', 'player-usa-1']);

  // Surname order, not roster order: two films on one side prove which it is.
  const two = indexShow({
    built: 'now',
    days: { 1: [], 2: [] },
    players: players.map((p) => (p.team === 'international' ? { ...p, film: `cards/${p.id}.mp4` } : p)),
  });
  assert.deepEqual(filmSections(two)[0].rows.map((r) => r.name), ['Ashvini Anjutgi', 'Alba Phillips']);
});

test('the film list says which one this screen was last sent to', () => {
  const cued = filmSections(filmShow, { cued: 'player-usa-1' });
  assert.deepEqual(cued.flatMap((s) => s.rows.filter((r) => r.cued).map((r) => r.name)), ['John Altman']);
  // Nobody cued, or somebody with no film cued, marks nothing rather than throwing.
  for (const who of ['', undefined, 'player-intl-2', 'nobody']) {
    const rows = filmSections(filmShow, { cued: who }).flatMap((s) => s.rows);
    assert.equal(rows.filter((r) => r.cued).length, 0, JSON.stringify(who));
  }
});

test('the film list filters by name, and an empty side is dropped rather than left blank', () => {
  assert.deepEqual(filmSections(filmShow, { query: 'altman' }).map((s) => s.title), ['USA']);
  assert.deepEqual(filmSections(filmShow, { query: 'ASH' }).map((s) => s.title), ['International']);
  // No match at all is an empty list - the dialog says so, rather than two headings.
  assert.deepEqual(filmSections(filmShow, { query: 'zzz' }), []);
  // A show with no films is the same shape: nothing to offer, and no crash.
  assert.deepEqual(filmSections(show), []);
  assert.deepEqual(filmSections(plain), []);
});
