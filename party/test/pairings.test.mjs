import { test } from 'node:test';
import assert from 'node:assert/strict';
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

// Verbatim from GET /pairings on staging, 11 October 2026.
const LIVE_TEAM = JSON.parse(`{"revealStep":0,"intl_team":{"player1_id":"","player2_id":""},"day":1,
 "usa_team":{"player1_id":"","player2_id":""},"revealOrder":"usa-first",
 "match_number":1,"id":"day1-team-1","type":"team"}`);
// Key sets verified against the live staging API (read-only GET /pairings,
// HTTP 200, 36 items) on 13 October 2026. Team items: LIVE_TEAM above plus the
// list below; singles items have no team objects and use per-player ids.
const TEAM_KEYS = ['day', 'id', 'intl_team', 'match_number', 'revealOrder', 'revealStep', 'type', 'usa_team'];
const SINGLES_KEYS = ['day', 'id', 'intl_player_id', 'match_number', 'revealOrder', 'revealStep', 'type', 'usa_player_id'];

const keys = (o) => Object.keys(o).sort();

test('always a full snapshot of 39 matches, 13 team then 26 singles', () => {
  const items = toPairingItems(initialState(show));
  assert.equal(items.length, 39);
  assert.equal(items.filter((i) => i.type === 'team').length, 13);
  assert.equal(items.filter((i) => i.type === 'singles').length, 26);
  assert.ok(items.slice(0, 13).every((i) => i.day === 1 && i.type === 'team'));
  assert.ok(items.slice(13).every((i) => i.day === 2 && i.type === 'singles'));
});

test('ids, numbering, day and type pinned at both ends of each day', () => {
  const items = toPairingItems(initialState(show));
  const pick = (i) => [items[i].id, items[i].match_number, items[i].day, items[i].type];
  assert.deepEqual(pick(0), ['day1-team-1', 1, 1, 'team']);
  assert.deepEqual(pick(12), ['day1-team-13', 13, 1, 'team']);
  assert.deepEqual(pick(13), ['day2-singles-1', 1, 2, 'singles']);
  assert.deepEqual(pick(38), ['day2-singles-26', 26, 2, 'singles']);
  assert.equal(typeof items[0].day, 'number');
  assert.equal(typeof items[0].match_number, 'number');
  // ids are unique and match_number is 1..n in order
  assert.equal(new Set(items.map((i) => i.id)).size, 39);
  items.slice(0, 13).forEach((it, k) => assert.equal(it.match_number, k + 1));
  items.slice(13).forEach((it, k) => assert.equal(it.match_number, k + 1));
});

test('team item has exactly the key set of the live table item', () => {
  const item = toPairingItems(initialState(show))[0];
  assert.deepEqual(keys(item), keys(LIVE_TEAM));
  assert.deepEqual(keys(item.intl_team), keys(LIVE_TEAM.intl_team));
  assert.deepEqual(keys(item.usa_team), keys(LIVE_TEAM.usa_team));
  for (const k of keys(LIVE_TEAM)) assert.equal(typeof item[k], typeof LIVE_TEAM[k], k);
});

test('every item has exactly the live key set for its type (staging, 13 Oct 2026)', () => {
  for (const item of toPairingItems(initialState(show))) {
    assert.deepEqual(keys(item), item.type === 'team' ? TEAM_KEYS : SINGLES_KEYS, item.id);
  }
  assert.deepEqual(keys(LIVE_TEAM), TEAM_KEYS);
});

function revealed(shown, firstSide = 'intl') {
  const s = initialState(show);
  for (const day of ['1', '2']) for (const slot of s.slots[day]) { slot.shown = shown; slot.firstSide = firstSide; }
  for (const slot of s.slots['1']) slot.usa = [`player-usa-${slot.index * 2 - 1}`, `player-usa-${slot.index * 2}`];
  for (const slot of s.slots['2']) slot.usa = [`player-usa-${slot.index}`];
  return s;
}

test('a team item matches the live table shape exactly (fully revealed)', () => {
  assert.deepEqual(toPairingItems(revealed('both'))[0], {
    id: 'day1-team-1', type: 'team', day: 1, match_number: 1,
    intl_team: { player1_id: 'player-intl-1', player2_id: 'player-intl-2' },
    usa_team: { player1_id: 'player-usa-1', player2_id: 'player-usa-2' },
    revealOrder: 'intl-first', revealStep: 2,
  });
});

test('an unrevealed team item is the placeholder shape: keys kept, ids blank', () => {
  assert.deepEqual(toPairingItems(initialState(show))[0], {
    id: 'day1-team-1', type: 'team', day: 1, match_number: 1,
    intl_team: { player1_id: '', player2_id: '' },
    usa_team: { player1_id: '', player2_id: '' },
    revealOrder: 'intl-first', revealStep: 0,
  });
});

test('a singles item matches the live table shape exactly (fully revealed)', () => {
  const item = toPairingItems(revealed('both'))[13];
  assert.deepEqual(keys(item), SINGLES_KEYS);
  assert.deepEqual(item, {
    id: 'day2-singles-1', type: 'singles', day: 2, match_number: 1,
    intl_player_id: 'player-intl-1', usa_player_id: 'player-usa-1',
    revealOrder: 'intl-first', revealStep: 2,
  });
});

test('every item is JSON-safe: only strings and numbers, one level of nesting', () => {
  let s = initialState(show);
  s = reduce(s, { name: 'reveal' }, show);
  const items = toPairingItems(s);
  for (const item of items) {
    for (const [k, v] of Object.entries(item)) {
      if (k === 'intl_team' || k === 'usa_team') {
        assert.equal(Object.getPrototypeOf(v), Object.prototype);
        for (const [k2, v2] of Object.entries(v)) assert.equal(typeof v2, 'string', `${item.id}.${k}.${k2}`);
      } else {
        assert.ok(typeof v === 'string' || typeof v === 'number', `${item.id}.${k} is ${typeof v}`);
        if (typeof v === 'number') assert.ok(Number.isFinite(v), `${item.id}.${k}`);
      }
    }
    const round = JSON.parse(JSON.stringify(item));
    assert.deepEqual(round, item);
    assert.equal(Object.hasOwn(item, 'undefined'), false);
  }
  const json = JSON.stringify(items);
  assert.equal(json.includes('null'), false);
  assert.equal(json.includes('undefined'), false);
  assert.equal(json.includes('NaN'), false);
});

test('only ids, numbers and fixed enums appear as values', () => {
  const s = revealed('both', 'usa');
  const idRe = /^(|player-(intl|usa)-\d+)$/;
  for (const item of toPairingItems(s)) {
    assert.match(item.id, /^day[12]-(team|singles)-\d+$/);
    assert.ok(['team', 'singles'].includes(item.type));
    assert.ok(['intl-first', 'usa-first'].includes(item.revealOrder));
    assert.ok([0, 1, 2].includes(item.revealStep));
    const ids = item.type === 'team'
      ? [...Object.values(item.intl_team), ...Object.values(item.usa_team)]
      : [item.intl_player_id, item.usa_player_id];
    for (const id of ids) assert.match(id, idRe);
  }
});

test('shown maps onto the revealStep the website reads', () => {
  let s = initialState(show);
  assert.equal(toPairingItems(s)[0].revealStep, 0);
  s = reduce(s, { name: 'reveal' }, show);
  assert.equal(toPairingItems(s)[0].revealStep, 1);
  s = reduce(s, { name: 'reveal' }, show);
  assert.equal(toPairingItems(s)[0].revealStep, 2);
  // other matches untouched
  assert.ok(toPairingItems(s).slice(1).every((i) => i.revealStep === 0));
});

test('shown maps directly for every value, on both days', () => {
  const s = initialState(show);
  s.slots['1'][4].shown = 'first';
  s.slots['1'][5].shown = 'both';
  s.slots['2'][25].shown = 'both';
  s.slots['2'][0].shown = 'first';
  const items = toPairingItems(s);
  assert.equal(items[4].revealStep, 1);
  assert.equal(items[5].revealStep, 2);
  assert.equal(items[13].revealStep, 1);
  assert.equal(items[38].revealStep, 2);
});

test('firstSide becomes revealOrder', () => {
  const s = reduce(initialState(show), { name: 'setFirstSide', side: 'usa' }, show);
  assert.equal(toPairingItems(s)[0].revealOrder, 'usa-first');
  assert.equal(toPairingItems(initialState(show))[0].revealOrder, 'intl-first');
});

test('assigned players land on the correct side and slot', () => {
  const s = initialState(show);
  for (const day of ['1', '2']) for (const slot of s.slots[day]) slot.shown = 'both';
  s.slots['1'][2].usa = ['player-usa-5', 'player-usa-6'];
  s.slots['2'][3].usa = ['player-usa-9'];
  const items = toPairingItems(s);
  assert.deepEqual(items[2].usa_team, { player1_id: 'player-usa-5', player2_id: 'player-usa-6' });
  assert.deepEqual(items[2].intl_team, { player1_id: 'player-intl-5', player2_id: 'player-intl-6' });
  assert.equal(items[16].usa_player_id, 'player-usa-9');
  assert.equal(items[16].intl_player_id, 'player-intl-4');
});

test('unassigned slots go up as empty strings, never undefined or null', () => {
  const s = initialState(show);
  s.slots['1'][0].usa = [];
  s.slots['2'][0].usa = [];
  const items = toPairingItems(s);
  assert.deepEqual(items[0].usa_team, { player1_id: '', player2_id: '' });
  assert.equal(items[13].usa_player_id, '');
});

test('two snapshots of the same state are identical, and the state is not mutated', () => {
  const s = reduce(initialState(show), { name: 'reveal' }, show);
  const before = JSON.stringify(s);
  assert.deepEqual(toPairingItems(s), toPairingItems(s));
  assert.equal(JSON.stringify(s), before);
});

// ---- Withholding: the table mirrors the room (ruled deviation from the brief) ----

const TEAM_IDS = (it) => ({
  intl: [it.intl_team.player1_id, it.intl_team.player2_id],
  usa: [it.usa_team.player1_id, it.usa_team.player2_id],
});
const SINGLES_IDS = (it) => ({ intl: [it.intl_player_id], usa: [it.usa_player_id] });

test('withholding: exactly the revealed sides are populated, for every shown x firstSide, both days', () => {
  for (const shown of ['none', 'first', 'both']) {
    for (const firstSide of ['intl', 'usa']) {
      const s = revealed(shown, firstSide);
      const items = toPairingItems(s);
      items.forEach((it, i) => {
        const day = it.day === 1 ? '1' : '2';
        const slot = s.slots[day][it.match_number - 1];
        const got = it.type === 'team' ? TEAM_IDS(it) : SINGLES_IDS(it);
        const open = { intl: shown === 'both' || (shown === 'first' && firstSide === 'intl'),
                       usa: shown === 'both' || (shown === 'first' && firstSide === 'usa') };
        for (const side of ['intl', 'usa']) {
          const want = open[side] ? slot[side] : slot[side].map(() => '');
          assert.deepEqual(got[side], want, `${shown}/${firstSide} ${it.id} ${side} (#${i})`);
          if (open[side]) assert.ok(got[side].every((x) => x !== ''), `${it.id} ${side} should be populated`);
        }
        assert.equal(it.revealStep, { none: 0, first: 1, both: 2 }[shown]);
        assert.equal(it.revealOrder, `${firstSide}-first`);
      });
    }
  }
});

test('regression guard: no id of a not-yet-revealed side appears anywhere in the item JSON', () => {
  for (const shown of ['none', 'first']) {
    for (const firstSide of ['intl', 'usa']) {
      const s = revealed(shown, firstSide);
      for (const it of toPairingItems(s)) {
        const json = JSON.stringify(it);
        const slot = s.slots[it.day === 1 ? '1' : '2'][it.match_number - 1];
        const hidden = shown === 'none' ? ['intl', 'usa'] : [firstSide === 'intl' ? 'usa' : 'intl'];
        for (const side of hidden) for (const id of slot[side]) {
          assert.ok(id !== '' && !json.includes(id), `${it.id} leaks ${id} at ${shown}/${firstSide}`);
        }
      }
    }
  }
  // a full unrevealed snapshot contains no player id at all
  assert.equal(/player-/.test(JSON.stringify(toPairingItems(initialState(show)))), false);
});

test('revealing through the reducer publishes only what the room has seen', () => {
  let s = reduce(initialState(show), { name: 'setFirstSide', side: 'usa' }, show);
  s = reduce(s, { name: 'reveal' }, show);
  let it = toPairingItems(s)[0];
  assert.equal(it.revealStep, 1);
  assert.deepEqual(it.intl_team, { player1_id: '', player2_id: '' });
  s = reduce(s, { name: 'reveal' }, show);
  it = toPairingItems(s)[0];
  assert.equal(it.revealStep, 2);
  assert.deepEqual(it.intl_team, { player1_id: 'player-intl-1', player2_id: 'player-intl-2' });
});

test('unrecognised shown falls back to hidden, with no ids and a defined revealStep', () => {
  for (const bad of ['bogus', undefined, null, 'constructor', '__proto__', 2]) {
    const s = revealed('both');
    s.slots['1'][0].shown = bad;
    s.slots['2'][0].shown = bad;
    const items = toPairingItems(s);
    for (const it of [items[0], items[13]]) {
      assert.equal(it.revealStep, 0, String(bad));
      assert.equal(/player-/.test(JSON.stringify(it)), false, String(bad));
    }
    assert.deepEqual(keys(items[0]), TEAM_KEYS);
    assert.deepEqual(keys(items[13]), SINGLES_KEYS);
  }
});

test('unrecognised firstSide falls back to intl and never prints undefined', () => {
  for (const bad of ['bogus', undefined, null, 'both']) {
    const s = revealed('first');
    s.slots['1'][0].firstSide = bad;
    s.slots['2'][0].firstSide = bad;
    const items = toPairingItems(s);
    for (const it of [items[0], items[13]]) {
      assert.equal(it.revealOrder, 'intl-first', String(bad));
    }
    // intl is the revealed side at step 1, usa stays blank
    assert.deepEqual(items[0].intl_team, { player1_id: 'player-intl-1', player2_id: 'player-intl-2' });
    assert.deepEqual(items[0].usa_team, { player1_id: '', player2_id: '' });
  }
});
