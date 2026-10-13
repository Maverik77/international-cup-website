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
// Singles shape per pairings/admin.html initializeEmptyPairings.
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

test('a team item matches the live table shape exactly', () => {
  assert.deepEqual(toPairingItems(initialState(show))[0], {
    id: 'day1-team-1', type: 'team', day: 1, match_number: 1,
    intl_team: { player1_id: 'player-intl-1', player2_id: 'player-intl-2' },
    usa_team: { player1_id: '', player2_id: '' },
    revealOrder: 'intl-first', revealStep: 0,
  });
});

test('a singles item matches the live table shape exactly', () => {
  const item = toPairingItems(initialState(show))[13];
  assert.deepEqual(keys(item), SINGLES_KEYS);
  assert.deepEqual(item, {
    id: 'day2-singles-1', type: 'singles', day: 2, match_number: 1,
    intl_player_id: 'player-intl-1', usa_player_id: '',
    revealOrder: 'intl-first', revealStep: 0,
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
  const s = reduce(initialState(show), { name: 'setFirstSide', side: 'usa' }, show);
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
