import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialState, reduce, project, slotProblems, CommandError } from '../lib/state.mjs';
import { indexShow } from '../build/build-show.mjs';

// Synthetic fixtures only: no real player data.
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
const run = (s, ...cmds) => cmds.reduce((acc, c) => reduce(acc, c, show), s);
const C = { name: 'reveal' };
const U1 = { name: 'assign', side: 'usa', players: ['player-usa-1', 'player-usa-2'] };

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

function rejects(state, cmd, pattern) {
  const before = JSON.stringify(state);
  assert.throws(() => reduce(state, cmd, show),
    (e) => e instanceof CommandError && (!pattern || pattern.test(e.message)) && /[.]$/.test(e.message) && e.message.length > 10);
  assert.equal(JSON.stringify(state), before, 'a rejected command must leave state untouched');
}

test('starts idle on day 1 slot 1 with the running order pre-filled', () => {
  const s = initialState(show);
  assert.equal(s.day, 1);
  assert.equal(s.mode, 'idle');
  assert.deepEqual(s.slots['1'][0].intl, ['player-intl-1', 'player-intl-2']);
  assert.deepEqual(s.slots['1'][0].usa, ['', '']);
  assert.equal(s.slots['1'][0].shown, 'none');
  assert.equal(s.slots['1'][0].firstSide, 'intl');
  assert.equal(s.slots['2'][0].firstSide, 'intl');
  assert.equal(s.slots['1'].length, 13);
  assert.equal(s.slots['2'].length, 26);
  assert.deepEqual(s.slideshow, { position: 0, dwellSeconds: 12 });
  assert.deepEqual(s.sync, { dirty: false, lastPushed: null, lastError: null });
  assert.equal(s.rev, 0);
  assert.deepEqual(s.history, []);
});

test('reveal walks none -> first -> both', () => {
  let s = run(initialState(show), C);
  assert.equal(s.slots['1'][0].shown, 'first');
  s = run(s, C);
  assert.equal(s.slots['1'][0].shown, 'both');
});

test('reveal when everything is already revealed is a silent no-op: same state, no rev bump, no history', () => {
  const both = run(initialState(show), C, C);
  const frozen = deepFreeze(JSON.parse(JSON.stringify(both)));
  const again = reduce(frozen, C, show);
  assert.equal(again, frozen);
  assert.equal(again.rev, both.rev);
  assert.equal(again.history.length, both.history.length);
  assert.equal(again.sync.dirty, true);
  const clean = run(both, { name: 'setSync', sync: { dirty: false } });
  assert.equal(reduce(clean, C, show).sync.dirty, false);
  assert.equal(reduce(clean, C, show).rev, clean.rev);
});

test('next completes the slot and advances', () => {
  const s = run(initialState(show), U1, C, C, { name: 'next' });
  assert.equal(s.slots['1'][0].done, true);
  assert.equal(s.current['1'], 1);
  assert.equal(s.mode, 'live');
  assert.equal(project(s, show).completed.length, 1);
  assert.deepEqual(project(s, show).completed[0].usa, ['player-usa-1', 'player-usa-2']);
});

test('next forces shown to both even if the operator skipped the reveal', () => {
  const s = run(initialState(show), { name: 'next' });
  assert.equal(s.slots['1'][0].shown, 'both');
});

test('next on the last slot completes it and stays put; a second next is rejected', () => {
  let s = initialState(show);
  s = { ...s, current: { ...s.current, 1: 12 } };
  s = run(s, { name: 'next' });
  assert.equal(s.current['1'], 12);
  assert.equal(s.slots['1'][12].done, true);
  // Day 1 ends 13 matches into a 39-match night, so the refusal names the Day 2
  // button (the id is day2 in private/operator.html) rather than only Undo.
  rejects(s, { name: 'next' }, /^Day 1: that was the last match\. Tap Day 2 to carry on, or use Undo, or pick another match\.$/);
  let d2 = run(initialState(show), { name: 'setDay', day: 2 });
  d2 = { ...d2, current: { ...d2.current, 2: 25 } };
  d2 = run(d2, { name: 'next' });
  rejects(d2, { name: 'next' }, /^Day 2: that was the last match\. Use Undo, or pick another match\.$/);
});

// F1: the whole night's first operator action used to leave the TV on the idle
// screen while the console said the side was revealed. A command that puts
// something on the screen leaves idle; assign, which puts nothing there yet,
// must NOT - going live with no panel revealed is a black TV in front of the
// room while the operator finds two names in a list of 26.
test('reveal and goto take the show out of idle; assign leaves the title up', () => {
  const cold = initialState(show);
  assert.equal(cold.mode, 'idle');
  assert.equal(reduce(cold, C, show).mode, 'live');
  assert.equal(reduce(cold, { name: 'goto', index: 4 }, show).mode, 'live');
  assert.equal(reduce(cold, U1, show).mode, 'idle', 'picking players shows nothing, so it changes nothing');
  assert.equal(run(cold, U1, { name: 'assign', side: 'intl', players: ['player-intl-3', 'player-intl-4'] }).mode, 'idle');
  // and once the show is live, assign does not knock it back to the title either
  assert.equal(run(cold, C, U1).mode, 'live');
  // Jumping to the match you are already on is only a no-op once the screen is
  // live; from a cold start it is the operator saying "show me this one".
  const here = reduce(cold, { name: 'goto', index: 0 }, show);
  assert.equal(here.mode, 'live');
  assert.equal(here.rev, cold.rev + 1);
  assert.equal(reduce(here, { name: 'goto', index: 0 }, show), here);
  // and the second reveal, the one that fills the other half of the screen
  assert.equal(run(cold, C, C).mode, 'live');
  // a deliberate idle (the holding screen between days) is still obeyed
  assert.equal(run(cold, C, { name: 'setMode', mode: 'idle' }).mode, 'idle');
});

test('assign rejects the wrong number of players, for both days', () => {
  const s = initialState(show);
  rejects(s, { name: 'assign', side: 'usa', players: ['player-usa-1'] }, /take 2 players a side, not 1/);
  rejects(s, { name: 'assign', side: 'usa', players: [] }, /take 2 players a side, not 0/);
  rejects(s, { name: 'assign', side: 'usa', players: 'player-usa-1' }, /take 2 players a side, not none/);
  const d2 = run(s, { name: 'setDay', day: 2 });
  rejects(d2, { name: 'assign', side: 'usa', players: ['player-usa-1', 'player-usa-2'] }, /take 1 player a side, not 2/);
});

test('assign rejects an id that is not in the show', () => {
  const s = initialState(show);
  rejects(s, { name: 'assign', side: 'usa', players: ['nope', 'player-usa-2'] }, /nope is not on the roster for this show/);
  rejects(s, { name: 'assign', side: 'usa', players: [42, 'player-usa-2'] }, /42 is not on the roster/);
});

test('assign rejects a bad side', () => {
  rejects(initialState(show), { name: 'assign', side: 'left', players: ['player-usa-1', 'player-usa-2'] }, /Pick International or USA/);
});

test('assign rejects a player from the other team, naming both teams', () => {
  const s = initialState(show);
  const cmd = { name: 'assign', side: 'usa', players: ['player-intl-1', 'player-intl-2'] };
  rejects(s, cmd, /International/);
  rejects(s, cmd, /not USA\. Pick someone from the USA list/);
  rejects(s, { name: 'assign', side: 'intl', players: ['player-usa-1', 'player-usa-2'] }, /U1 plays for USA, not International/);
});

test('assign accepts empty placeholders, so a side can be cleared', () => {
  const s = run(initialState(show), U1, { name: 'assign', side: 'usa', players: ['', ''] });
  assert.deepEqual(s.slots['1'][0].usa, ['', '']);
});

test('assign writes only the named side of the current slot', () => {
  const s = run(initialState(show), { name: 'goto', index: 3 }, U1);
  assert.deepEqual(s.slots['1'][3].usa, ['player-usa-1', 'player-usa-2']);
  assert.deepEqual(s.slots['1'][3].intl, ['player-intl-7', 'player-intl-8']);
  assert.deepEqual(s.slots['1'][0].usa, ['', '']);
  assert.deepEqual(s.slots['2'][0].usa, ['']);
});

test('day 2 slots take one player a side', () => {
  const s = run(initialState(show), { name: 'setDay', day: 2 },
    { name: 'assign', side: 'usa', players: ['player-usa-1'] });
  assert.deepEqual(s.slots['2'][0].usa, ['player-usa-1']);
  assert.deepEqual(s.slots['1'][0].usa, ['', '']);
});

test('setDay switches day and keeps each day\'s position', () => {
  let s = run(initialState(show), { name: 'goto', index: 5 }, { name: 'setDay', day: 2 }, { name: 'goto', index: 9 }, { name: 'setDay', day: 1 });
  assert.equal(s.day, 1);
  assert.equal(s.current['1'], 5);
  assert.equal(s.current['2'], 9);
});

test('setDay rejects any day other than 1 or 2', () => {
  const s = initialState(show);
  for (const day of [0, 3, '1', null, undefined, 1.5]) rejects(s, { name: 'setDay', day }, /The day must be 1 or 2/);
});

test('setFirstSide sets the current slot and rejects a bad side', () => {
  const s = run(initialState(show), { name: 'setFirstSide', side: 'usa' });
  assert.equal(s.slots['1'][0].firstSide, 'usa');
  assert.equal(s.slots['1'][1].firstSide, 'intl');
  rejects(s, { name: 'setFirstSide', side: 'both' }, /Pick International or USA/);
});

test('goto jumps anywhere and keeps what was there', () => {
  let s = run(initialState(show), U1);
  s = run(s, { name: 'goto', index: 7 });
  assert.equal(s.current['1'], 7);
  s = run(s, { name: 'goto', index: 0 });
  assert.deepEqual(s.slots['1'][0].usa, ['player-usa-1', 'player-usa-2']);
});

test('goto rejects out-of-range and non-integer indexes', () => {
  const s = initialState(show);
  for (const index of [13, 99, -1, 1.5, '3', undefined]) rejects(s, { name: 'goto', index }, /There is no match/);
  rejects(run(s, { name: 'setDay', day: 2 }), { name: 'goto', index: 26 }, /1 to 26/);
});

test('reopen un-completes a match and jumps to it', () => {
  let s = run(initialState(show), C, C, { name: 'next' });
  s = run(s, { name: 'reopen', day: 1, index: 0 });
  assert.equal(s.slots['1'][0].done, false);
  assert.equal(s.current['1'], 0);
  assert.equal(project(s, show).completed.length, 0);
});

test('reopen can switch to the other day', () => {
  const s = run(initialState(show), { name: 'reopen', day: 2, index: 4 });
  assert.equal(s.day, 2);
  assert.equal(s.current['2'], 4);
});

test('reopen rejects a bad day or index', () => {
  const s = initialState(show);
  rejects(s, { name: 'reopen', day: 3, index: 0 }, /The day must be 1 or 2/);
  rejects(s, { name: 'reopen', day: 1, index: 13 }, /There is no match/);
  rejects(s, { name: 'reopen', day: 2, index: -1 }, /There is no match/);
});

test('undo reverses the last action', () => {
  let s = run(initialState(show), C);
  assert.equal(s.slots['1'][0].shown, 'first');
  s = run(s, { name: 'undo' });
  assert.equal(s.slots['1'][0].shown, 'none');
  assert.equal(s.history.length, 0);
});

test('undo with empty history is rejected', () => {
  rejects(initialState(show), { name: 'undo' }, /^Nothing to undo\.$/);
  rejects(run(initialState(show), C, { name: 'undo' }), { name: 'undo' }, /^Nothing to undo\.$/);
});

test('undo marks the outbox dirty and keeps the latest push record', () => {
  let s = run(initialState(show), C);
  s = run(s, { name: 'setSync', sync: { dirty: false, lastPushed: 'T1', lastError: null } });
  s = run(s, { name: 'undo' });
  assert.equal(s.sync.dirty, true);
  assert.equal(s.sync.lastPushed, 'T1');
  assert.equal(s.rev, 3);
});

test('undo of next restores position and done flag', () => {
  let s = run(initialState(show), C, C, { name: 'next' });
  s = run(s, { name: 'undo' });
  assert.equal(s.current['1'], 0);
  assert.equal(s.slots['1'][0].done, false);
  assert.equal(s.slots['1'][0].shown, 'both');
});

test('setMode accepts the three modes; slideshow restarts at 0', () => {
  let s = run(initialState(show), { name: 'slideshowGoto', position: 4 }, { name: 'setMode', mode: 'live' });
  assert.equal(s.mode, 'live');
  assert.equal(s.slideshow.position, 4);
  s = run(s, { name: 'setMode', mode: 'slideshow' });
  assert.equal(s.mode, 'slideshow');
  assert.equal(s.slideshow.position, 0);
  s = run(s, { name: 'setMode', mode: 'idle' });
  assert.equal(s.mode, 'idle');
});

test('setMode rejects an unknown mode', () => {
  rejects(initialState(show), { name: 'setMode', mode: 'party' }, /idle, live, slideshow or photos/);
  rejects(initialState(show), { name: 'setMode' }, /screen mode must be/);
});

test('photos is a mode, and it carries no position of its own', () => {
  const s = run(initialState(show), { name: 'setMode', mode: 'photos' });
  assert.equal(s.mode, 'photos');
  // Deliberately unlike slideshow: a screen showing photographs keeps its own
  // place in the loop, so there is nothing here to save, undo or migrate into
  // a state file written before the mode existed.
  assert.equal(s.photos, undefined);
  assert.deepEqual(s.slideshow, initialState(show).slideshow);
  // And it is a toggle, not a trapdoor.
  assert.equal(run(s, { name: 'setMode', mode: 'live' }).mode, 'live');
});

test('slideshowGoto sets the position and rejects nonsense', () => {
  const s = run(initialState(show), { name: 'slideshowGoto', position: 7 });
  assert.equal(s.slideshow.position, 7);
  for (const position of [-1, 1.5, '2', undefined]) rejects(s, { name: 'slideshowGoto', position }, /slideshow position must be a whole number/);
});

test('history is bounded to 50 and its entries carry no history', () => {
  let s = initialState(show);
  for (let i = 0; i < 80; i++) s = reduce(s, { name: 'setFirstSide', side: i % 2 ? 'usa' : 'intl' }, show);
  assert.equal(s.history.length, 50);
  for (const h of s.history) assert.equal('history' in h, false);
  assert.equal(s.rev, 80);
});

test('history keeps the most recent entries, not the oldest', () => {
  let s = initialState(show);
  for (let i = 0; i < 60; i++) s = reduce(s, { name: 'slideshowGoto', position: i }, show);
  assert.equal(s.history[0].slideshow.position, 9);
  assert.equal(s.history[49].slideshow.position, 58);
});

test('every accepted command marks the outbox dirty and bumps rev', () => {
  const a = initialState(show);
  const b = reduce(a, C, show);
  assert.equal(b.sync.dirty, true);
  assert.equal(b.rev, a.rev + 1);
  assert.equal(b.history.length, 1);
  assert.equal(b.history[0].rev, 0);
});

test('setSync clears dirty without pushing history, but bumps rev', () => {
  const a = run(initialState(show), C);
  const b = reduce(a, { name: 'setSync', sync: { dirty: false, lastPushed: '2026-10-22T23:00:00Z', lastError: null } }, show);
  assert.equal(b.sync.dirty, false);
  assert.equal(b.sync.lastPushed, '2026-10-22T23:00:00Z');
  assert.equal(b.history.length, a.history.length);
  assert.equal(b.rev, a.rev + 1);
  assert.deepEqual(b.slots, a.slots);
});

test('setSync can record an error and rejects malformed input', () => {
  const a = initialState(show);
  const b = reduce(a, { name: 'setSync', sync: { lastError: 'offline' } }, show);
  assert.equal(b.sync.lastError, 'offline');
  assert.equal(b.sync.dirty, false);
  rejects(a, { name: 'setSync' }, /sync status was missing/);
  rejects(a, { name: 'setSync', sync: 'ok' }, /sync status was missing/);
  rejects(a, { name: 'setSync', sync: { dirty: 'yes' } }, /sync status was malformed/);
});

test('a command the reducer does not know is rejected, not ignored', () => {
  rejects(initialState(show), { name: 'launchMissiles' }, /does not understand/);
  rejects(initialState(show), { name: 'toString' }, /does not understand/);
  rejects(initialState(show), { name: 'constructor' }, /does not understand/);
  rejects(initialState(show), {}, /empty command/);
  rejects(initialState(show), null, /empty command/);
});

test('reduce never mutates the state it was given', () => {
  const a = initialState(show);
  const snapshot = JSON.stringify(a);
  reduce(a, C, show);
  assert.equal(JSON.stringify(a), snapshot);
});

test('reduce returns new objects that do not alias the input', () => {
  const a = run(initialState(show), C);
  const b = reduce(a, { name: 'setFirstSide', side: 'usa' }, show);
  b.slots['1'][0].intl.push('x');
  b.slots['1'][1].shown = 'both';
  b.current['1'] = 9;
  assert.equal(a.slots['1'][0].intl.length, 2);
  assert.equal(a.slots['1'][1].shown, 'none');
  assert.equal(a.current['1'], 0);
});

// Purity, proven: a command that mutates in place corrupts undo and
// desynchronises the stage from the console.
test('every command type runs against a deeply frozen state without mutating it', () => {
  const rich = run(initialState(show), U1, C, C, { name: 'next' }, { name: 'setDay', day: 2 }, C);
  const commands = [
    { name: 'setDay', day: 1 },
    { name: 'goto', index: 3 },
    { name: 'setFirstSide', side: 'usa' },
    { name: 'assign', side: 'usa', players: ['player-usa-5'] },
    { name: 'reveal' },
    { name: 'next' },
    { name: 'reopen', day: 1, index: 0 },
    { name: 'undo' },
    { name: 'setMode', mode: 'slideshow' },
    { name: 'slideshowGoto', position: 3 },
    { name: 'setSync', sync: { dirty: false, lastPushed: 'T', lastError: null } },
  ];
  const seen = new Set(commands.map((c) => c.name));
  for (const name of ['setDay', 'goto', 'setFirstSide', 'assign', 'reveal', 'next', 'reopen', 'undo', 'setMode', 'slideshowGoto', 'setSync']) {
    assert.ok(seen.has(name), name);
  }
  for (const state of [rich, run(rich, { name: 'setDay', day: 1 })]) {
    const frozen = deepFreeze(JSON.parse(JSON.stringify(state)));
    const snapshot = JSON.stringify(frozen);
    for (const cmd of commands) {
      let out;
      try {
        out = reduce(frozen, cmd, show);
      } catch (e) {
        assert.ok(e instanceof CommandError, `${cmd.name} threw ${e.name}: ${e.message}`);
        continue;
      }
      if (out === frozen) assert.ok(['reveal', 'goto', 'setDay'].includes(cmd.name), `${cmd.name} returned its input`);
      assert.equal(JSON.stringify(frozen), snapshot, `${cmd.name} changed its input`);
      project(out, show);
    }
  }
  // the day-2 frozen state accepts every command, so none was skipped by a throw
  const f2 = deepFreeze(JSON.parse(JSON.stringify(rich)));
  const accepted = commands.filter((c) => { try { reduce(f2, c, show); return true; } catch { return false; } });
  assert.ok(accepted.length >= 10, `only ${accepted.length} commands ran`);
});

test('project shows the next slot for preloading, and nothing past the end', () => {
  const s = initialState(show);
  assert.deepEqual(project(s, show).next.intl, ['player-intl-3', 'player-intl-4']);
  const last = { ...s, current: { ...s.current, 1: 12 } };
  assert.deepEqual(project(last, show).next, { intl: [], usa: [] });
});

test('project returns the Wire shape and copies rather than aliases', () => {
  const s = run(initialState(show), U1);
  const w = project(s, show);
  assert.deepEqual(Object.keys(w).sort(), ['completed', 'day', 'mode', 'next', 'rehearsal', 'rev', 'slideshow', 'slot', 'sync']);
  assert.deepEqual(Object.keys(w.slot).sort(), ['firstSide', 'index', 'intl', 'problems', 'shown', 'usa']);
  assert.equal(w.rehearsal, false);
  w.slot.usa.push('x');
  w.sync.dirty = 'x';
  assert.equal(s.slots['1'][0].usa.length, 2);
  assert.equal(s.sync.dirty, true);
});

test('completed runs day 1 then day 2', () => {
  let s = run(initialState(show), C, C, { name: 'next' });
  s = run(s, { name: 'setDay', day: 2 }, C, C, { name: 'next' });
  assert.deepEqual(project(s, show).completed.map((c) => c.day), [1, 2]);
});

// REVIEW FOCUS 5: operator misclick under pressure.
const P = (intl, usa, index = 1) => ({ index, intl, usa });

test('the same player on both sides of one match is reported', () => {
  const problems = slotProblems(P(['player-intl-1', 'player-intl-2'], ['player-intl-1', 'player-usa-2']), 1, []);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /player-intl-1 appears twice in this match/);
});

test('the same player twice on the same side is reported once', () => {
  const problems = slotProblems(P(['player-intl-1', 'player-intl-2'], ['player-usa-1', 'player-usa-1']), 1, []);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /player-usa-1 appears twice in this match/);
  assert.equal(slotProblems(P(['player-intl-1', 'player-intl-1'], ['player-usa-1', 'player-usa-2']), 1, []).length, 1);
  assert.equal(slotProblems(P(['a'], ['a']), 2, []).length, 1);
});

test('the same player in two different matches on the same day is reported', () => {
  const others = [P(['player-intl-1', 'player-intl-2'], ['', ''], 1)];
  const problems = slotProblems(P(['player-intl-1', 'player-intl-3'], ['', ''], 2), 1, others);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /player-intl-1 is already in match 1/);
  // symmetric: the other match is flagged too
  const back = slotProblems(others[0], 1, [P(['player-intl-1', 'player-intl-3'], ['', ''], 2)]);
  assert.equal(back.length, 1);
  assert.match(back[0], /match 2/);
});

test('a slot is not compared with itself, and empty placeholders never collide', () => {
  const me = P(['player-intl-1', 'player-intl-2'], ['', ''], 4);
  assert.deepEqual(slotProblems(me, 1, [me, P(['player-intl-3', 'player-intl-4'], ['', ''], 5)]), []);
  assert.deepEqual(slotProblems(me, 1, [P(['', ''], ['', ''], 5)]), []);
});

test('an id that is not in the show is reported when the show is supplied', () => {
  const problems = slotProblems(P(['player-intl-1', 'ghost-9'], ['', '']), 1, [], show);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /ghost-9 is not a player in the show/);
  assert.deepEqual(slotProblems(P(['player-intl-1', 'player-intl-2'], ['', '']), 1, [], show), []);
});

test('an unknown id reaches the console through project', () => {
  const s = initialState(show);
  const bad = JSON.parse(JSON.stringify(s));
  bad.slots['1'][0].usa = ['ghost-9', ''];
  assert.match(project(bad, show).slot.problems[0], /ghost-9 is not a player/);
});

test('slotProblems never throws, whatever it is handed', () => {
  const junk = [
    [null, 1, []], [undefined, 1, undefined], [{}, 1, null], [P(null, undefined), 1, [null, undefined, 5]],
    [P([1, {}, null], [[], 'a']), 1, [{ index: 2, intl: 'zz', usa: 7 }]],
    [P(['a'], ['b']), 1, [{ index: 2, get intl() { throw new Error('boom'); } }]],
  ];
  for (const [slot, day, all] of junk) {
    let out;
    assert.doesNotThrow(() => { out = slotProblems(slot, day, all, show); });
    assert.ok(Array.isArray(out));
  }
  assert.doesNotThrow(() => slotProblems(P(['a'], ['b']), 1, [], { byId: null }));
  const r = slotProblems(P(['a'], ['b']), 1, [{ index: 2, get intl() { throw new Error('boom'); } }]);
  assert.equal(r.length, 1);
  assert.match(r[0], /could not check/);
});

test('problems ride along on the projected slot, and project survives them', () => {
  const s = run(initialState(show), { name: 'assign', side: 'usa', players: ['player-usa-1', 'player-usa-1'] });
  assert.equal(project(s, show).slot.problems.length, 1);
});

test('a duplicate across matches shows on the projected slot before reveal', () => {
  const s = run(initialState(show), { name: 'goto', index: 1 },
    { name: 'assign', side: 'intl', players: ['player-intl-1', 'player-intl-4'] });
  const w = project(s, show);
  assert.equal(w.slot.shown, 'none');
  assert.equal(w.slot.problems.length, 1);
  assert.match(w.slot.problems[0], /already in match 1 on day 1/);
});

test('day 2 duplicates are checked within day 2 only', () => {
  const s = run(initialState(show), { name: 'setDay', day: 2 },
    { name: 'assign', side: 'usa', players: ['player-usa-1'] },
    { name: 'goto', index: 1 }, { name: 'assign', side: 'usa', players: ['player-usa-1'] });
  assert.equal(project(s, show).slot.problems.length, 1);
  assert.equal(project(run(s, { name: 'setDay', day: 1 }), show).slot.problems.length, 0);
});

test('a clean slot has no problems', () => {
  assert.deepEqual(slotProblems(P(['player-intl-1', 'player-intl-2'], ['player-usa-1', 'player-usa-2']), 1, []), []);
});

// A show that went through JSON has lost its non-enumerable byId.
const unindexed = JSON.parse(JSON.stringify(show));

test('reduce fails fast and loudly on a show without byId, and does not blame the operator', () => {
  assert.equal(unindexed.byId, undefined);
  for (const bad of [unindexed, undefined, null, {}]) {
    for (const cmd of [{ name: 'assign', side: 'usa', players: ['player-usa-1', 'player-usa-2'] }, C, { name: 'undo' }]) {
      assert.throws(() => reduce(initialState(show), cmd, bad),
        (e) => !(e instanceof CommandError) && /no byId index.*indexShow/.test(e.message));
    }
  }
  assert.doesNotThrow(() => reduce(initialState(show), C, indexShowCopy()));
});
function indexShowCopy() { return indexShow(JSON.parse(JSON.stringify(show))); }

test('slotProblems on an unindexed show never throws and does not silently skip the check', () => {
  const slot = P(['player-intl-1', 'player-intl-2'], ['', '']);
  for (const bad of [unindexed, {}, null]) {
    let out;
    assert.doesNotThrow(() => { out = slotProblems(slot, 1, [], bad); });
    assert.equal(out.length, 1);
    assert.match(out[0], /not been indexed/);
  }
  assert.deepEqual(slotProblems(slot, 1, []), []);
  const w = project(initialState(show), unindexed);
  assert.match(w.slot.problems[0], /not been indexed/);
  assert.doesNotThrow(() => project(initialState(show), undefined));
  assert.match(project(initialState(show), undefined).slot.problems[0], /not been indexed/);
});

test('ids that collide with inherited object members are not players', () => {
  for (const id of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    assert.match(slotProblems(P([id, ''], ['', '']), 1, [], show)[0], /is not a player in the show/);
    rejects(initialState(show), { name: 'assign', side: 'usa', players: [id, 'player-usa-2'] }, /is not on the roster/);
  }
});

test('goto to the current slot and setDay to the current day are silent no-ops', () => {
  const s = run(initialState(show), C);
  for (const cmd of [{ name: 'goto', index: 0 }, { name: 'setDay', day: 1 }]) {
    const out = reduce(s, cmd, show);
    assert.equal(out, s);
    assert.equal(out.rev, s.rev);
    assert.equal(out.history.length, s.history.length);
  }
  const moved = reduce(s, { name: 'goto', index: 1 }, show);
  assert.equal(moved.rev, s.rev + 1);
  assert.equal(reduce(s, { name: 'setDay', day: 2 }, show).rev, s.rev + 1);
  rejects(s, { name: 'goto', index: 99 }, /There is no match/);
  rejects(s, { name: 'setDay', day: 3 }, /The day must be/);
});

// goto carries an optional day so that jumping across days is ONE command, and
// therefore one Undo. Without it the console would send setDay then goto, and
// the operator reaching for Undo mid-show would have to tap it twice.
test('goto crosses days in one command, and one undo brings it back', () => {
  const start = run(initialState(show), { name: 'goto', index: 4 });
  assert.equal(start.day, 1);

  const over = run(start, { name: 'goto', day: 2, index: 11 });
  assert.equal(over.day, 2);
  assert.equal(over.current[2], 11);
  assert.equal(over.current[1], 4, 'the day it left is still where it was');
  assert.equal(over.mode, 'live');

  const back = run(over, { name: 'undo' });
  assert.equal(back.day, 1);
  assert.equal(back.current[1], 4);
});

test('an absent day means the day in play, and the no-op rule is per day', () => {
  const here = run(initialState(show), { name: 'goto', index: 3 });
  // Same day, same index, already live: nothing to do, the same object comes back.
  assert.equal(reduce(here, { name: 'goto', index: 3 }, show), here);
  assert.equal(reduce(here, { name: 'goto', day: 1, index: 3 }, show), here);
  // The SAME index on the OTHER day is a different match, so it must move.
  const other = reduce(here, { name: 'goto', day: 2, index: 3 }, show);
  assert.notEqual(other, here);
  assert.equal(other.day, 2);
  // Idle is never a no-op: it means "put this one on the screen".
  const idle = reduce(here, { name: 'setMode', mode: 'idle' }, show);
  assert.equal(reduce(idle, { name: 'goto', index: 3 }, show).mode, 'live');
});

test('the index is checked against the day being jumped to, not the day in play', () => {
  const s = initialState(show);
  // Day 1 holds 13 matches, day 2 holds 26: index 20 exists on one and not the other.
  assert.equal(run(s, { name: 'goto', day: 2, index: 20 }).current[2], 20);
  rejects(s, { name: 'goto', day: 1, index: 20 }, /no match 21 on Day 1/i);
  rejects(s, { name: 'goto', day: 2, index: 26 }, /no match 27 on Day 2/i);
  for (const day of [0, 3, '2', null, 1.5]) {
    rejects(s, { name: 'goto', day, index: 0 }, /day must be 1 or 2/i);
  }
});

// --- putting the draw back ---------------------------------------------------
//
// Two commands, kept apart on purpose: resetDraw throws away who was drawn,
// setAnnounced keeps every name and only takes it back off the website.

// A night part-way through: Day 1 matches 1 and 2 drawn, revealed and done,
// match 3 drawn and half revealed, Day 2 match 1 drawn and done.
function midNight() {
  let s = initialState(show);
  s = run(s,
    { name: 'assign', side: 'usa', players: ['player-usa-1', 'player-usa-2'] },
    { name: 'next' },
    { name: 'assign', side: 'usa', players: ['player-usa-3', 'player-usa-4'] },
    { name: 'next' },
    { name: 'assign', side: 'usa', players: ['player-usa-5', 'player-usa-6'] },
    { name: 'reveal' },
    { name: 'assign', side: 'usa', players: ['player-usa-7'], day: 2, index: 0 },
    { name: 'setAnnounced', scope: 'match', day: 2, index: 0, announced: true });
  return s;
}

// What a reset leaves behind: both sides empty, the International pairings the
// running order put there included.
const blank = (day, number) => ({
  index: number,
  firstSide: 'intl',
  intl: Array.from({ length: day === 1 ? 2 : 1 }, () => ''),
  usa: Array.from({ length: day === 1 ? 2 : 1 }, () => ''),
  shown: 'none',
  done: false,
});
const blankDay = (day) => Array.from({ length: day === 1 ? 13 : 26 }, (_, i) => blank(day, i + 1));
const fresh1 = (i) => blank(1, i + 1);

test('a reset empties a match, the International side with the rest', () => {
  const s = run(midNight(), { name: 'resetDraw', scope: 'match', day: 1, index: 0 });
  assert.deepEqual(s.slots['1'][0], fresh1(0));
  // BOTH sides, not only the one drawn on the night. A match whose contents are
  // wrong can be wrong about either side, and the running order reappearing by
  // itself would quietly undo an override nobody asked it to undo.
  assert.deepEqual(s.slots['1'][0].intl, ['', '']);
  assert.deepEqual(s.slots['1'][0].usa, ['', '']);
  assert.equal(s.slots['1'][0].shown, 'none');
  assert.equal(s.slots['1'][0].done, false);
  // and nothing else moved
  assert.deepEqual(s.slots['1'][1], midNight().slots['1'][1]);
});

test('reset all starts the night again: both days, back to day 1 match 1, title card', () => {
  const s = run(midNight(), { name: 'resetDraw', scope: 'all' });
  assert.deepEqual(s.slots, { 1: blankDay(1), 2: blankDay(2) });
  assert.equal(s.day, 1);
  assert.equal(s.current['1'], 0);
  assert.equal(s.current['2'], 0);
  assert.equal(s.mode, 'idle');
  assert.deepEqual(project(s, show).completed, []);
});

test('reset one day leaves the other day alone', () => {
  const before = midNight();
  const s = run(before, { name: 'resetDraw', scope: 'day', day: 1 });
  assert.deepEqual(s.slots['1'], blankDay(1));
  assert.deepEqual(s.slots['2'], before.slots['2']);
  assert.equal(s.current['1'], 0);
  // Day 2 is untouched, so the operator's place in it must not move.
  assert.equal(s.current['2'], before.current['2']);
  assert.deepEqual(project(s, show).completed.map((c) => c.day), [2]);
});

test('resetting the day NOT in play does not drag the console off the match in play', () => {
  const before = midNight();            // on day 1, match 3
  const s = run(before, { name: 'resetDraw', scope: 'day', day: 2 });
  assert.equal(s.day, 1);
  assert.equal(s.current['1'], before.current['1']);
  assert.equal(s.mode, before.mode);    // still live: nothing on screen changed
  assert.deepEqual(s.slots['2'], blankDay(2));
});

test('reset from a match onwards runs Day 1 into Day 2, as the evening does', () => {
  const before = midNight();
  const s = run(before, { name: 'resetDraw', scope: 'from', day: 1, index: 1 });
  assert.deepEqual(s.slots['1'][0], before.slots['1'][0], 'match 1 is before the cut');
  for (let i = 1; i < 13; i++) assert.deepEqual(s.slots['1'][i], fresh1(i));
  assert.deepEqual(s.slots['2'], blankDay(2), 'the whole of Day 2 comes after');
  assert.equal(s.current['1'], 1);
  assert.equal(s.current['2'], 0);
  assert.deepEqual(project(s, show).completed.map((c) => c.index), [1]);
});

test('reset from a match the operator has not reached leaves them where they are', () => {
  const before = midNight();            // on day 1 match 3, so current['1'] is 2
  const s = run(before, { name: 'resetDraw', scope: 'from', day: 1, index: 8 });
  assert.equal(s.current['1'], 2);
  assert.equal(s.mode, before.mode);
  assert.deepEqual(s.slots['1'][2], before.slots['1'][2]);
});

test('reset last finds the latest match the night reached, and stands the operator on it', () => {
  // Day 2 match 1 is the latest thing that happened in midNight().
  let s = run(midNight(), { name: 'resetDraw', scope: 'last' });
  assert.deepEqual(s.slots['2'][0], blank(2, 1));
  assert.equal(s.current['2'], 0);
  assert.deepEqual(s.slots['1'][2], midNight().slots['1'][2], 'Day 1 is untouched');
  // Now the latest is Day 1 match 3, half revealed. Again, and it goes back.
  s = run(s, { name: 'resetDraw', scope: 'last' });
  assert.deepEqual(s.slots['1'][2], fresh1(2));
  assert.equal(s.current['1'], 2);
  // And again: match 2, which was done.
  s = run(s, { name: 'resetDraw', scope: 'last' });
  assert.deepEqual(s.slots['1'][1], fresh1(1));
  assert.equal(s.current['1'], 1);
});

test('a match already put back is behind the night, so reset last walks on past it', () => {
  // The emptied match must not read as the latest thing that happened, or
  // tapping "put the last match back" twice would put the same one back twice.
  let s = midNight();
  s = run(s, { name: 'resetDraw', scope: 'match', day: 2, index: 0 });
  s = run(s, { name: 'resetDraw', scope: 'last' });
  assert.deepEqual(s.slots['1'][2], fresh1(2), 'it walked back to Day 1 match 3');
  assert.equal(s.current['1'], 2);
  // All the way back to the start, one match at a time, and then it stops.
  s = run(s, { name: 'resetDraw', scope: 'last' }, { name: 'resetDraw', scope: 'last' });
  assert.deepEqual(s.slots['1'].slice(0, 3), [fresh1(0), fresh1(1), fresh1(2)]);
  rejects(s, { name: 'resetDraw', scope: 'last' }, /nothing has been drawn/i);
});

test('reset last on a night that has not started says so rather than resetting match 1', () => {
  rejects(initialState(show), { name: 'resetDraw', scope: 'last' }, /nothing has been drawn/i);
});

test('reset last notices a match whose only change is an overridden running order', () => {
  // Nothing revealed and no USA names, so "is anything in it" would say no.
  const s = run(initialState(show),
    { name: 'assign', side: 'intl', players: ['player-intl-5', 'player-intl-6'], day: 1, index: 0 });
  const back = run(s, { name: 'resetDraw', scope: 'last' });
  assert.deepEqual(back.slots['1'][0], fresh1(0));
});

test('reset last notices a match whose only change is which side reveals first', () => {
  const s = run(initialState(show), { name: 'setFirstSide', side: 'usa' });
  const back = run(s, { name: 'resetDraw', scope: 'last' });
  assert.equal(back.slots['1'][0].firstSide, 'intl');
});

test('resetting the match in play takes the stage back to the title card', () => {
  const live = run(midNight(), { name: 'goto', index: 2 });
  assert.equal(live.mode, 'live');
  assert.equal(run(live, { name: 'resetDraw', scope: 'current' }).mode, 'idle');
  assert.equal(run(live, { name: 'resetDraw', scope: 'match', day: 1, index: 2 }).mode, 'idle');
  // A match that is not on screen does not touch the mode.
  assert.equal(run(live, { name: 'resetDraw', scope: 'match', day: 1, index: 7 }).mode, 'live');
});

test('a reset is one undo however many matches it swallowed', () => {
  const before = midNight();
  const s = run(before, { name: 'resetDraw', scope: 'all' });
  const back = run(s, { name: 'undo' });
  assert.deepEqual(back.slots, before.slots);
  assert.equal(back.day, before.day);
  assert.equal(back.current['1'], before.current['1']);
  assert.equal(back.mode, before.mode);
});

test('a reset scope the console does not know is refused, not guessed at', () => {
  rejects(midNight(), { name: 'resetDraw', scope: 'everything' }, /stretch of the night/);
  rejects(midNight(), { name: 'resetDraw' }, /stretch of the night/);
  rejects(midNight(), { name: 'resetDraw', scope: 'day', day: 3 }, /day must be 1 or 2/);
  rejects(midNight(), { name: 'resetDraw', scope: 'match', day: 1, index: 13 }, /no match 14 on Day 1/);
  rejects(midNight(), { name: 'resetDraw', scope: 'from', day: 2, index: -1 }, /Pick a match from 1 to 26/);
});

// --- announced, or not -------------------------------------------------------

test('calling a match back hides the names without forgetting who was drawn', () => {
  const before = midNight();
  const s = run(before, { name: 'setAnnounced', scope: 'match', day: 1, index: 0, announced: false });
  assert.deepEqual(s.slots['1'][0].usa, ['player-usa-1', 'player-usa-2'], 'still drawn');
  assert.equal(s.slots['1'][0].shown, 'none');
  // Both fields: `shown` is what the website publishes and `done` is what the
  // draw-so-far screen lists, so a called-back match has to leave both.
  assert.equal(s.slots['1'][0].done, false);
  assert.deepEqual(project(s, show).completed.map((c) => `${c.day}-${c.index}`), ['1-2', '2-1']);
});

test('calling every match back empties the draw so far and the website, and keeps every name', () => {
  const before = midNight();
  const s = run(before, { name: 'setAnnounced', scope: 'all', announced: false });
  assert.deepEqual(project(s, show).completed, []);
  for (const d of ['1', '2']) {
    for (const slot of s.slots[d]) {
      assert.equal(slot.shown, 'none');
      assert.equal(slot.done, false);
    }
  }
  assert.deepEqual(s.slots['1'][0].usa, before.slots['1'][0].usa);
  assert.deepEqual(s.slots['2'][0].usa, before.slots['2'][0].usa);
  // Nobody moved: calling the names back is not starting the night again.
  assert.equal(s.day, before.day);
  assert.equal(s.current['1'], before.current['1']);
});

test('calling the match in play back leaves the panel up and draws the curtain', () => {
  const live = run(midNight(), { name: 'goto', index: 2 });
  const s = run(live, { name: 'setAnnounced', scope: 'current', announced: false });
  assert.equal(s.mode, 'live', 'the panel stays up: hiding the names is the point');
  assert.equal(s.slots['1'][2].shown, 'none');
  assert.equal(project(s, show).slot.shown, 'none');
});

test('calling back one day leaves the other day announced', () => {
  const s = run(midNight(), { name: 'setAnnounced', scope: 'day', day: 1, announced: false });
  assert.deepEqual(project(s, show).completed.map((c) => c.day), [2]);
});

test('calling back from a match onwards keeps everything before it', () => {
  const s = run(midNight(), { name: 'setAnnounced', scope: 'from', day: 1, index: 1, announced: false });
  assert.deepEqual(project(s, show).completed.map((c) => `${c.day}-${c.index}`), ['1-1']);
  assert.equal(s.slots['1'][0].shown, 'both');
});

test('announcing a match that is on screen leaves the title card behind', () => {
  let s = initialState(show);
  assert.equal(s.mode, 'idle');
  s = run(s, { name: 'setAnnounced', scope: 'current', announced: true });
  assert.equal(s.mode, 'live');
  assert.equal(s.slots['1'][0].shown, 'both');
  assert.equal(s.slots['1'][0].done, true);
  // Announcing a match the room is not looking at does not light the screen up.
  const quiet = run(initialState(show), { name: 'setAnnounced', scope: 'match', day: 2, index: 5, announced: true });
  assert.equal(quiet.mode, 'idle');
});

test('setAnnounced without saying which way is refused', () => {
  rejects(midNight(), { name: 'setAnnounced', scope: 'all' }, /whether those matches are announced/);
  rejects(midNight(), { name: 'setAnnounced', scope: 'all', announced: 'no' }, /whether those matches are announced/);
  rejects(midNight(), { name: 'setAnnounced', scope: 'nonsense', announced: false }, /stretch of the night/);
});

// --- overriding one match without showing the room --------------------------

test('assign can name another match, and nothing moves to it', () => {
  const before = midNight();
  const s = run(before, { name: 'assign', side: 'usa', players: ['player-usa-9', 'player-usa-10'], day: 1, index: 6 });
  assert.deepEqual(s.slots['1'][6].usa, ['player-usa-9', 'player-usa-10']);
  assert.equal(s.day, before.day);
  assert.equal(s.current['1'], before.current['1']);
  assert.equal(s.mode, before.mode);
  assert.deepEqual(s.slots['1'][2], before.slots['1'][2], 'the match in play is untouched');
});

test('a named Day 2 match takes one player a side even while Day 1 is in play', () => {
  const s = run(midNight(), { name: 'assign', side: 'usa', players: ['player-usa-20'], day: 2, index: 4 });
  assert.deepEqual(s.slots['2'][4].usa, ['player-usa-20']);
  rejects(midNight(), { name: 'assign', side: 'usa', players: ['player-usa-20', 'player-usa-21'], day: 2, index: 4 },
    /Day 2 matches take 1 player a side/);
  // And the other way round: the day in play is not what decides it.
  rejects(midNight(), { name: 'assign', side: 'usa', players: ['player-usa-20'], day: 1, index: 4 },
    /Day 1 matches take 2 players a side/);
});

test('a named match still checks the roster and the side', () => {
  rejects(midNight(), { name: 'assign', side: 'usa', players: ['player-intl-9', 'player-usa-10'], day: 1, index: 6 },
    /plays for International, not USA/);
  rejects(midNight(), { name: 'assign', side: 'usa', players: ['nobody', 'player-usa-10'], day: 1, index: 6 },
    /not on the roster/);
  rejects(midNight(), { name: 'assign', side: 'usa', players: ['player-usa-9', 'player-usa-10'], day: 3, index: 0 },
    /day must be 1 or 2/);
  rejects(midNight(), { name: 'assign', side: 'usa', players: ['player-usa-9', 'player-usa-10'], day: 1, index: 99 },
    /no match 100 on Day 1/);
});

test('setFirstSide can name another match too', () => {
  const before = midNight();
  const s = run(before, { name: 'setFirstSide', side: 'usa', day: 2, index: 3 });
  assert.equal(s.slots['2'][3].firstSide, 'usa');
  assert.equal(s.slots['1'][2].firstSide, before.slots['1'][2].firstSide);
});
