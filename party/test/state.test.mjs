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
  rejects(s, { name: 'next' }, /^Day 1: that was the last match\.$/);
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
  rejects(initialState(show), { name: 'setMode', mode: 'party' }, /idle, live or slideshow/);
  rejects(initialState(show), { name: 'setMode' }, /screen mode must be/);
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
      if (cmd.name !== 'reveal') assert.notEqual(out, frozen, cmd.name);
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
