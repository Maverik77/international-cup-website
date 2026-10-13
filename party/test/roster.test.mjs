import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadRoster, RosterError } from '../build/roster.mjs';

function fixture(teams) {
  const dir = mkdtempSync(join(tmpdir(), 'roster-'));
  const path = join(dir, 'player-details.json');
  writeFileSync(path, JSON.stringify({ updated: '2026-10-11', teams }));
  return path;
}

test('assigns stable 1-based ids in file order', () => {
  const path = fixture({
    international: [{ name: 'Ashvini Anjutgi', country: 'India' }, { name: 'Erik Wagner', country: 'Germany' }],
    usa: [{ name: 'John Altman', hometown: 'Washington, DC', school: 'Virginia Tech' }],
  });
  const players = loadRoster(path);
  assert.deepEqual(players.map((p) => p.id), ['player-intl-1', 'player-intl-2', 'player-usa-1']);
});

test('defaults country to USA for the USA team and blanks missing fields', () => {
  const path = fixture({ international: [], usa: [{ name: 'Jay Collins' }] });
  const [p] = loadRoster(path);
  assert.deepEqual(p, {
    id: 'player-usa-1', team: 'usa', name: 'Jay Collins',
    country: 'USA', hometown: '', school: '',
  });
});

test('keeps hometown and school for a player who declined website publication', () => {
  // publish:false means "party cards only" - the card still needs the detail.
  const path = fixture({
    international: [],
    usa: [{ name: 'Tom Walsh', hometown: 'Great Falls, VA', school: 'University of Delaware', publish: false }],
  });
  const [p] = loadRoster(path);
  assert.equal(p.hometown, 'Great Falls, VA');
  assert.equal(p.school, 'University of Delaware');
});

test('never leaks the publish flag into the roster', () => {
  const path = fixture({ international: [], usa: [{ name: 'Tom Walsh', publish: false }] });
  assert.equal('publish' in loadRoster(path)[0], false);
});

test('explains itself when the details file is missing', () => {
  assert.throws(() => loadRoster('/nope/player-details.json'), (e) =>
    e instanceof RosterError && /contacts\/player-details\.json/.test(e.message));
});

test('rejects a player with no name', () => {
  const path = fixture({ international: [{ country: 'India' }], usa: [] });
  assert.throws(() => loadRoster(path), RosterError);
});

test('reads the real roster: 26 and 26', () => {
  const players = loadRoster('contacts/player-details.json');
  assert.equal(players.filter((p) => p.team === 'international').length, 26);
  assert.equal(players.filter((p) => p.team === 'usa').length, 26);
  assert.equal(new Set(players.map((p) => p.id)).size, 52);
});
