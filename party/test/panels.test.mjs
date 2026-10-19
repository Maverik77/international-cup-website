import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  formatFor, perSide, panelPlan, panelsForMatch, preloadSrcs, slideshowEntry,
  panelsToLoad, srcAfterError, screenPlan, matchTitle, joinsFor, DAY_MATCHES,
  screenNameFrom, roleOf, drawList, filmList, filmCueOf, SCREEN_ROLES, DEFAULT_SCREEN, MAX_SCREENS,
} from '../public/panels.mjs';
import { indexShow, DAY1_MATCHES, DAY2_MATCHES } from '../build/build-show.mjs';
import { initialState, reduce, project } from '../lib/state.mjs';

function makeShow() {
  const players = [];
  const mk = (id, team, name) => ({
    id, team, name, country: team === 'usa' ? 'USA' : 'India', generic: true,
    cards: { '4x9': `cards/${id}-4x9.mp4`, '8x9': `cards/${id}-8x9.mp4` },
    fallback: { '4x9': `cards/${id}-flag-4x9.mp4`, '8x9': `cards/${id}-flag-8x9.mp4` },
  });
  for (let i = 1; i <= 26; i++) players.push(mk(`player-intl-${i}`, 'international', `I${i}`));
  for (let i = 1; i <= 26; i++) players.push(mk(`player-usa-${i}`, 'usa', `U${i}`));
  return indexShow({ built: 'now', players, days: { 1: [], 2: [] } });
}
const show = makeShow();

const wire = (over = {}) => ({
  day: 1, mode: 'live', rev: 1, rehearsal: false,
  slot: { index: 1, firstSide: 'intl', intl: ['player-intl-1', 'player-intl-2'],
    usa: ['player-usa-1', 'player-usa-2'], shown: 'none', problems: [] },
  next: { intl: ['player-intl-3', 'player-intl-4'], usa: ['', ''] },
  completed: [], slideshow: { position: 0, dwellSeconds: 12 },
  sync: { dirty: false, lastPushed: null, lastError: null },
  ...over,
});
const withSlot = (over, w = {}) => wire({ slot: { ...wire().slot, ...over }, ...w });

test('day 1 is four 4x9 panels, day 2 is two 8x9', () => {
  assert.equal(formatFor(1), '4x9');
  assert.equal(formatFor(2), '8x9');
  assert.equal(perSide(1), 2);
  assert.equal(perSide(2), 1);
  assert.equal(panelPlan(wire(), show).fmt, '4x9');
  assert.equal(panelPlan(wire(), show).panels.length, 4);
  const d2 = panelPlan(wire({ day: 2, slot: { ...wire().slot, intl: ['player-intl-1'], usa: ['player-usa-1'] } }), show);
  assert.equal(d2.panels.length, 2);
  assert.equal(d2.fmt, '8x9');
  assert.equal(d2.panels[0].src, 'cards/player-intl-1-8x9.mp4');
  assert.deepEqual(d2.panels.map((p) => p.key), ['intl-0', 'usa-0']);
});

test('International is always the left half, whoever reveals first', () => {
  for (const firstSide of ['intl', 'usa']) {
    const plan = panelPlan(withSlot({ firstSide }), show);
    assert.deepEqual(plan.panels.map((p) => p.key), ['intl-0', 'intl-1', 'usa-0', 'usa-1']);
    assert.deepEqual(plan.panels.map((p) => p.side), ['intl', 'intl', 'usa', 'usa']);
    assert.deepEqual(plan.panels.map((p) => p.pos), [0, 1, 0, 1]);
    assert.deepEqual(plan.panels.map((p) => p.playerId),
      ['player-intl-1', 'player-intl-2', 'player-usa-1', 'player-usa-2']);
  }
});

test('nothing is visible before the first reveal', () => {
  assert.deepEqual(panelPlan(wire(), show).panels.map((p) => p.visible), [false, false, false, false]);
});

test('the first reveal lights only the first side', () => {
  const intlFirst = panelPlan(withSlot({ shown: 'first', firstSide: 'intl' }), show);
  assert.deepEqual(intlFirst.panels.map((p) => p.visible), [true, true, false, false]);
  const usaFirst = panelPlan(withSlot({ shown: 'first', firstSide: 'usa' }), show);
  assert.deepEqual(usaFirst.panels.map((p) => p.visible), [false, false, true, true]);
});

test('both lights everything', () => {
  const plan = panelPlan(withSlot({ shown: 'both' }), show);
  assert.deepEqual(plan.panels.map((p) => p.visible), [true, true, true, true]);
});

test('an unfilled side stays dark even when revealed', () => {
  const plan = panelPlan(withSlot({ usa: ['', ''], shown: 'both' }), show);
  assert.deepEqual(plan.panels.map((p) => p.visible), [true, true, false, false]);
  assert.equal(plan.panels[2].src, null);
  assert.equal(plan.panels[2].playerId, null);
  assert.equal(plan.panels[2].fallback, null);
});

test('a panel carries the clip, the fallback and the name', () => {
  const [p] = panelPlan(wire(), show).panels;
  assert.equal(p.src, 'cards/player-intl-1-4x9.mp4');
  assert.equal(p.fallback, 'cards/player-intl-1-flag-4x9.mp4');
  assert.notEqual(p.src, p.fallback);
  assert.equal(p.name, 'I1');
  assert.equal(p.playerId, 'player-intl-1');
});

test('a hidden panel still carries its clip so it can load ahead of the reveal', () => {
  const [p] = panelPlan(wire(), show).panels;
  assert.equal(p.visible, false);
  assert.equal(p.src, 'cards/player-intl-1-4x9.mp4');
});

test('a player id the show does not know does not throw', () => {
  const plan = panelPlan(withSlot({ usa: ['ghost', 'player-usa-2'], shown: 'both' }), show);
  assert.equal(plan.panels[2].src, null);
  assert.equal(plan.panels[2].name, '');
  assert.equal(plan.panels[2].visible, false);
  assert.equal(plan.panels[3].visible, true);
});

test('the same player on both sides of a match yields a full plan', () => {
  const plan = panelPlan(withSlot({ intl: ['player-intl-1', 'player-intl-2'], usa: ['player-intl-1', 'player-usa-2'], shown: 'both' }), show);
  assert.equal(plan.panels.length, 4);
  assert.deepEqual(plan.panels.map((p) => p.key), ['intl-0', 'intl-1', 'usa-0', 'usa-1']);
  assert.equal(plan.panels[0].src, plan.panels[2].src);
  assert.ok(plan.panels.every((p) => p.visible));
  // the same player twice on one side too
  const twice = panelPlan(withSlot({ intl: ['player-intl-1', 'player-intl-1'] }), show);
  assert.equal(twice.panels.length, 4);
});

test('an empty-string placeholder is a dark panel, not a player', () => {
  const plan = panelPlan(withSlot({ intl: ['', ''], usa: ['', ''], shown: 'both' }), show);
  assert.equal(plan.panels.length, 4);
  assert.ok(plan.panels.every((p) => !p.visible && p.src === null && p.playerId === null && p.name === ''));
});

test('a slot with missing side arrays, or no slot or wire at all, still plans', () => {
  for (const slot of [{ shown: 'both' }, { shown: 'both', intl: null, usa: 'nope' }, {}, null, 'x']) {
    const plan = panelPlan(wire({ slot }), show);
    assert.equal(plan.panels.length, 4, JSON.stringify(slot));
    assert.ok(plan.panels.every((p) => p.visible === false && p.src === null));
  }
  const noSlot = wire();
  delete noSlot.slot;
  const plan = panelPlan(noSlot, show);
  assert.equal(plan.panels.length, 4);
  assert.deepEqual(plan.panels.map((p) => p.key), ['intl-0', 'intl-1', 'usa-0', 'usa-1']);
  assert.equal(panelPlan(undefined, show).panels.length > 0, true);
  assert.equal(panelPlan(null, null).panels.length > 0, true);
  assert.equal(panelPlan(wire(), undefined).panels.length, 4);
});

test('hostile ids (inherited names, non-strings) never resolve or throw', () => {
  const junk = ['constructor', '__proto__', 'toString', 'hasOwnProperty', 7, {}, [], null, undefined, true];
  const plan = panelPlan(withSlot({ intl: junk.slice(0, 2), usa: junk.slice(2, 4), shown: 'both' }), show);
  assert.ok(plan.panels.every((p) => p.src === null && !p.visible));
  for (const id of junk) {
    assert.doesNotThrow(() => panelPlan(withSlot({ intl: [id, id], usa: [id, id], shown: 'both' }), show));
    assert.doesNotThrow(() => preloadSrcs(wire({ next: { intl: [id], usa: [id] } }), show));
  }
});

test('a half-built player (no cards, no name) degrades instead of throwing', () => {
  const odd = indexShow({ built: 'x', players: [
    { id: 'p1' },
    { id: 'p2', name: 'Two', cards: {}, fallback: { '4x9': 'cards/p2-flag.mp4' } },
    { id: 'p3', name: 7, cards: null, fallback: null },
  ], days: {} });
  const plan = panelPlan(withSlot({ intl: ['p1', 'p2'], usa: ['p3', ''], shown: 'both' }), odd);
  assert.equal(plan.panels[0].src, null);
  assert.equal(plan.panels[1].src, 'cards/p2-flag.mp4');
  assert.equal(plan.panels[2].name, '');
});

test('it works on the show as the browser receives it, with no byId', () => {
  const asJson = JSON.parse(JSON.stringify(show));
  assert.equal(asJson.byId, undefined);
  const plan = panelPlan(wire(), asJson);
  assert.equal(plan.panels[0].name, 'I1');
  assert.equal(plan.panels[0].src, 'cards/player-intl-1-4x9.mp4');
  assert.equal(panelPlan(withSlot({ intl: ['constructor', ''] }), asJson).panels[0].src, null);
  assert.deepEqual(preloadSrcs(wire(), asJson), ['cards/player-intl-3-4x9.mp4', 'cards/player-intl-4-4x9.mp4']);
});

test('no raw player id is ever a name the stage could print', () => {
  const plan = panelPlan(withSlot({
    intl: ['player-intl-ghost', 'player-intl-2'], usa: ['player-intl-ghost', ''], shown: 'both',
  }), show);
  for (const p of plan.panels) {
    assert.doesNotMatch(p.name, /player-/);
    assert.equal(typeof p.name, 'string');
  }
  assert.equal(plan.panels[0].playerId, null);
  assert.equal(plan.panels[0].name, '');
});

test('slot.problems never reaches the plan, whatever it contains', () => {
  // ids of real players who are NOT in this slot, so they cannot appear legitimately
  const leaked = ['player-usa-26', 'player-intl-25', 'player-usa-17'];
  const problems = [
    `${leaked[0]} appears twice in this match`,
    `${leaked[1]} is already in match 3 on day 1`,
    `${leaked[2]} is not a player in the show`,
  ];
  for (const shown of ['none', 'first', 'both']) {
    const withProblems = panelPlan(withSlot({ problems, shown }), show);
    const text = JSON.stringify(withProblems);
    for (const id of leaked) assert.ok(!text.includes(id), `${id} leaked into the plan`);
    assert.ok(!/appears twice|already in match|not a player/.test(text));
    // and it is identical to the plan with no problems at all
    assert.deepEqual(withProblems, panelPlan(withSlot({ problems: [], shown }), show));
  }
  const alsoMatch = panelsForMatch({ day: 1, intl: [], usa: [], problems }, show);
  assert.ok(!JSON.stringify(alsoMatch).includes(leaked[0]));
});

// A player with no clip at all is drawn as their name. stage.css paints that
// name only for `.panel.text-only.shown`, and the plan is what decides `shown`:
// what is assertable here, and what matters, is that the panel stays invisible
// until the reveal reaches its side, so the name cannot appear early. The CSS
// rule itself needs a browser to assert, so it is not asserted here; the former
// grep over stage.css could only ever have caught a rename.
test('a nameless clip is still hidden until its side is revealed', () => {
  const noClip = indexShow({ built: 'now', days: { 1: [], 2: [] }, players: [
    { id: 'p-intl', team: 'international', name: 'No Clip', country: 'India', cards: {}, fallback: {} },
    { id: 'p-usa', team: 'usa', name: 'Also None', country: 'USA', cards: {}, fallback: {} },
  ] });
  const w = (shown) => ({ day: 2, mode: 'live', slot: { index: 1, firstSide: 'intl', intl: ['p-intl'], usa: ['p-usa'], shown, problems: [] } });
  const hidden = panelPlan(w('none'), noClip).panels;
  assert.deepEqual(hidden.map((p) => p.src), [null, null]);
  assert.deepEqual(hidden.map((p) => p.name), ['No Clip', 'Also None']);
  assert.deepEqual(hidden.map((p) => p.visible), [false, false]);
  assert.deepEqual(panelPlan(w('first'), noClip).panels.map((p) => p.visible), [true, false]);
  assert.deepEqual(panelPlan(w('both'), noClip).panels.map((p) => p.visible), [true, true]);
});

test('preload lists the next slot, both sides, skipping blanks and unknowns', () => {
  assert.deepEqual(preloadSrcs(wire(), show), ['cards/player-intl-3-4x9.mp4', 'cards/player-intl-4-4x9.mp4']);
  assert.deepEqual(preloadSrcs(wire({ next: { intl: [], usa: [] } }), show), []);
  assert.deepEqual(preloadSrcs(wire({ next: { intl: ['ghost'], usa: ['player-usa-9'] } }), show), ['cards/player-usa-9-4x9.mp4']);
  assert.deepEqual(preloadSrcs(wire({ day: 2, next: { intl: ['player-intl-5'], usa: [] } }), show), ['cards/player-intl-5-8x9.mp4']);
  assert.deepEqual(preloadSrcs(wire({ next: undefined }), show), []);
  assert.deepEqual(preloadSrcs(undefined, show), []);
});

test('the slideshow walks completed matches and wraps', () => {
  const completed = [
    { day: 1, index: 1, intl: ['player-intl-1', 'player-intl-2'], usa: ['player-usa-1', 'player-usa-2'] },
    { day: 2, index: 1, intl: ['player-intl-3'], usa: ['player-usa-3'] },
  ];
  assert.equal(slideshowEntry(wire({ completed, slideshow: { position: 0, dwellSeconds: 12 } })).day, 1);
  assert.equal(slideshowEntry(wire({ completed, slideshow: { position: 1, dwellSeconds: 12 } })).day, 2);
  assert.equal(slideshowEntry(wire({ completed, slideshow: { position: 2, dwellSeconds: 12 } })).day, 1);
  assert.equal(slideshowEntry(wire({ completed: [], slideshow: { position: 0, dwellSeconds: 12 } })), null);
  assert.equal(slideshowEntry(wire({ completed, slideshow: { position: -1 } })).day, 1);
  assert.equal(slideshowEntry(wire({ completed, slideshow: undefined })).day, 1);
  assert.equal(slideshowEntry(wire({ completed: [null] })), null);
  assert.equal(slideshowEntry(undefined), null);
});

test('a slideshow match shows every panel at once and picks the format from its own day', () => {
  const plan = panelsForMatch({ day: 2, index: 1, intl: ['player-intl-3'], usa: ['player-usa-3'] }, show);
  assert.equal(plan.fmt, '8x9');
  assert.equal(plan.panels.length, 2);
  assert.ok(plan.panels.every((p) => p.visible));
  const d1 = panelsForMatch({ day: 1, intl: ['player-intl-1', 'player-intl-2'], usa: ['player-usa-1', 'ghost'] }, show);
  assert.deepEqual(d1.panels.map((p) => p.key), ['intl-0', 'intl-1', 'usa-0', 'usa-1']);
  assert.deepEqual(d1.panels.map((p) => p.visible), [true, true, true, false]);
  assert.doesNotThrow(() => panelsForMatch(null, show));
  assert.doesNotThrow(() => panelsForMatch({ day: 1 }, show));
});

test('the diff touches only a panel whose player changed', () => {
  const before = panelPlan(withSlot({ shown: 'first' }), show).panels;
  const applied = before.map((p) => p.playerId);
  // revealing the second side changes visibility only: nothing is reloaded
  const after = panelPlan(withSlot({ shown: 'both' }), show).panels;
  assert.deepEqual(panelsToLoad(applied, after), []);
  // one player swapped: only that box
  const swapped = panelPlan(withSlot({ shown: 'both', usa: ['player-usa-1', 'player-usa-9'] }), show).panels;
  assert.deepEqual(panelsToLoad(applied, swapped), [3]);
  // a player cleared down to nothing is a change too
  const cleared = panelPlan(withSlot({ usa: ['player-usa-1', ''] }), show).panels;
  assert.deepEqual(panelsToLoad(applied, cleared), [3]);
  // first ever render loads all four, including empty ones
  assert.deepEqual(panelsToLoad([], after), [0, 1, 2, 3]);
  assert.deepEqual(panelsToLoad(undefined, after), [0, 1, 2, 3]);
  const blank = panelPlan(withSlot({ intl: ['', ''], usa: ['', ''] }), show).panels;
  assert.deepEqual(panelsToLoad([undefined, undefined, undefined, undefined], blank), [0, 1, 2, 3]);
  assert.deepEqual(panelsToLoad([null, null, null, null], blank), []);
});

test('the fallback is chosen once and never loops', () => {
  const [p] = panelPlan(wire(), show).panels;
  assert.equal(srcAfterError(p, `http://hub/${p.src}`), 'cards/player-intl-1-flag-4x9.mp4');
  assert.equal(srcAfterError(p, p.src), 'cards/player-intl-1-flag-4x9.mp4');
  // the fallback itself failing: nowhere left to go
  assert.equal(srcAfterError(p, `http://hub/${p.fallback}`), null);
  assert.equal(srcAfterError(p, p.fallback), null);
  // no fallback, junk input
  assert.equal(srcAfterError({ ...p, fallback: null }, p.src), null);
  assert.equal(srcAfterError(null, p.src), null);
  assert.equal(srcAfterError(p, undefined), 'cards/player-intl-1-flag-4x9.mp4');
  // a generic player whose clip IS its fallback has nowhere to go either
  const generic = { ...p, src: p.fallback };
  assert.equal(srcAfterError(generic, `/${generic.src}`), null);
});

test('the real manifest plans every player on both days, fallbacks distinct for bespoke players', () => {
  const real = JSON.parse(readFileSync(new URL('../show.json', import.meta.url), 'utf8'));
  assert.equal(real.byId, undefined);
  const ids = real.players.map((p) => p.id);
  for (const day of [1, 2]) {
    const n = perSide(day);
    const plan = panelPlan({ day, slot: { shown: 'both', firstSide: 'usa',
      intl: ids.filter((i) => i.includes('intl')).slice(0, n), usa: ids.filter((i) => i.includes('usa')).slice(0, n) } }, real);
    assert.equal(plan.panels.length, 2 * n);
    assert.ok(plan.panels.every((p) => p.visible && p.src && p.fallback && p.name));
  }
  assert.ok(real.players.some((p) => !p.generic && p.cards['4x9'] !== p.fallback['4x9']));
});

// THE STAGE'S GATE, over the real reducer. The holding screen exists so a
// working idle is not mistaken for a dead TV - and the first Reveal of the night
// must leave it. Asserting mode alone would still pass if the stage stopped
// honouring the mode; this asserts the plan the stage applies.
test('the gate: a cold start holds, the first Reveal goes live, and the slideshow and holding screen still work', () => {
  const drawn = indexShow({ built: 'now', players: show.players, days: {
    1: [{ index: 1, intl: ['player-intl-1', 'player-intl-2'], usa: ['player-usa-1', 'player-usa-2'] }],
    2: [{ index: 1, intl: ['player-intl-3'], usa: ['player-usa-3'] }],
  } });
  let s = initialState(drawn);
  const onScreen = () => screenPlan(project(s, drawn), drawn);
  const visible = () => onScreen().plan.panels.filter((p) => p.visible);

  assert.deepEqual(onScreen(), { screen: 'idle', plan: null });  // cold start: the holding screen

  // Picking the players shows nothing yet, so the title stays up: a live layer
  // with no panel revealed is a black TV, and black reads as broken.
  s = reduce(s, { name: 'assign', side: 'usa', players: ['player-usa-5', 'player-usa-6'] }, drawn);
  assert.deepEqual(onScreen(), { screen: 'idle', plan: null });

  s = reduce(s, { name: 'reveal' }, drawn);
  assert.equal(onScreen().screen, 'live');                       // F1: not the holding screen
  assert.equal(onScreen().plan.fmt, '4x9');
  assert.deepEqual(visible().map((p) => p.key), ['intl-0', 'intl-1']);
  assert.ok(visible().every((p) => p.src), 'a revealed panel has a clip to play');

  s = reduce(s, { name: 'reveal' }, drawn);
  assert.equal(visible().length, 4);

  s = reduce(s, { name: 'next' }, drawn);
  s = reduce(s, { name: 'setMode', mode: 'slideshow' }, drawn);
  assert.deepEqual(onScreen(), { screen: 'slideshow', plan: null });
  s = reduce(s, { name: 'setMode', mode: 'idle' }, drawn);
  assert.deepEqual(onScreen(), { screen: 'idle', plan: null });
  // junk in, holding screen out: never a crash on the way to the TV
  for (const junk of [undefined, null, {}, { mode: 'party' }, 'live']) {
    assert.deepEqual(screenPlan(junk, drawn), { screen: 'idle', plan: null });
  }
});

// --- the match number and the glyphs between the panels ----------------------

const glyphs = (plan) => plan.joins.map((j) => `${j.glyph}${j.visible ? '' : '?'}`).join(' ');

// panels.mjs is served to the browser, so it cannot import the build's constants
// and keeps its own copy. If the field size ever changes, this is what notices.
test('the stage counts the same number of matches the build makes', () => {
  assert.equal(DAY_MATCHES[1], DAY1_MATCHES);
  assert.equal(DAY_MATCHES[2], DAY2_MATCHES);
});

test('before anything is revealed the number owns the screen, and nothing else is on it', () => {
  const plan = panelPlan(withSlot({ index: 7, shown: 'none' }), show);
  assert.deepEqual(plan.match, { day: 'Day 1', match: 'Match 7 of 13', big: true });
  assert.equal(plan.panels.some((p) => p.visible), false, 'no card may be up yet');
  assert.equal(plan.joins.some((j) => j.visible), false, 'no glyph may be up yet');
});

test('the first reveal docks the number and lights only that side\'s partner mark', () => {
  const plan = panelPlan(withSlot({ index: 7, shown: 'first', firstSide: 'intl' }), show);
  assert.equal(plan.match.big, false);
  assert.equal(plan.match.match, 'Match 7 of 13');
  assert.equal(glyphs(plan), '+ VS? +?');

  // ...and the same when USA goes first: the mark belongs to the side, not the half.
  const usaFirst = panelPlan(withSlot({ shown: 'first', firstSide: 'usa' }), show);
  assert.equal(glyphs(usaFirst), '+? VS? +');
});

test('the second reveal brings up VS, and VS waits for it', () => {
  assert.equal(glyphs(panelPlan(withSlot({ shown: 'both' }), show)), '+ VS +');
  const vs = panelPlan(withSlot({ shown: 'both' }), show).joins[1];
  assert.deepEqual(vs, { at: 1, glyph: 'VS', kind: 'vs', side: null, visible: true });
});

test('a glyph sits on the seam between two panels', () => {
  const day1 = panelPlan(withSlot({ shown: 'both' }), show);
  assert.deepEqual(day1.joins.map((j) => j.at), [0, 1, 2]);
  assert.deepEqual(day1.joins.map((j) => j.kind), ['partner', 'vs', 'partner']);
  assert.deepEqual(day1.joins.map((j) => j.side), ['intl', null, 'usa']);
  // at+1 over the panel count is the fraction across: quarters on day 1, half on day 2.
  assert.deepEqual(day1.joins.map((j) => (j.at + 1) / day1.panels.length), [0.25, 0.5, 0.75]);
  const day2 = panelPlan(wire({ day: 2, slot: { index: 4, firstSide: 'intl', intl: ['player-intl-1'], usa: ['player-usa-1'], shown: 'both', problems: [] } }), show);
  assert.deepEqual(day2.joins.map((j) => (j.at + 1) / day2.panels.length), [0.5]);
});

test('day 2 is one VS and no partner mark, and counts to 26', () => {
  const plan = panelPlan(wire({ day: 2, slot: { index: 26, firstSide: 'usa', intl: ['player-intl-1'], usa: ['player-usa-1'], shown: 'first', problems: [] } }), show);
  assert.equal(plan.panels.length, 2);
  assert.deepEqual(plan.joins.map((j) => j.glyph), ['VS']);
  assert.equal(glyphs(plan), 'VS?');
  assert.deepEqual(plan.match, { day: 'Day 2', match: 'Match 26 of 26', big: false });
  // A single player has no partner, so a "first revealed" day 2 side lights nothing.
  assert.equal(panelPlan(wire({ day: 2, slot: { index: 1, firstSide: 'usa', intl: ['player-intl-1'], usa: ['player-usa-1'], shown: 'both', problems: [] } }), show).joins[0].visible, true);
});

test('a number the stage cannot make sense of prints nothing, never "Match undefined"', () => {
  for (const [day, index] of [[undefined, undefined], [3, 1], [1, 0], [1, -4], [1, 1.5], [1, '2'], [null, null], [1, undefined]]) {
    const t = matchTitle(day, index, 'none');
    assert.equal(typeof t.day, 'string');
    assert.equal(typeof t.match, 'string');
    assert.ok(!/undefined|null|NaN/.test(`${t.day} ${t.match}`), JSON.stringify([day, index, t]));
  }
  // A day outside the show still numbers the match; it just cannot say how many.
  assert.equal(matchTitle(3, 4, 'none').match, 'Match 4');
  assert.equal(matchTitle(3, 4, 'none').day, 'Day 3');
  assert.doesNotThrow(() => joinsFor(undefined, null));
  assert.doesNotThrow(() => joinsFor(1, 'nope'));
  assert.equal(joinsFor(1, 'nope').every((j) => j.visible === false), true);
  for (const slot of [{ shown: 'both' }, {}, null, 'x', undefined]) {
    assert.equal(panelPlan(wire({ slot }), show).joins.length, 3);
  }
});

test('a slideshow frame carries its own number, docked, with every glyph up', () => {
  const plan = panelsForMatch({ day: 1, index: 9, intl: ['player-intl-1', 'player-intl-2'], usa: ['player-usa-1', 'player-usa-2'] }, show);
  assert.deepEqual(plan.match, { day: 'Day 1', match: 'Match 9 of 13', big: false });
  assert.equal(glyphs(plan), '+ VS +');
  assert.equal(panelsForMatch({ day: 2, index: 3, intl: ['player-intl-1'], usa: ['player-usa-1'] }, show).match.match, 'Match 3 of 26');
  assert.doesNotThrow(() => panelsForMatch(null, show));
  assert.equal(panelsForMatch(null, show).match.match, '');
});

// Over the real reducer, because the whole point is what the room sees between
// one match and the next. Asserting on a flag would still pass if the number
// never reached the plan the stage applies.
test('Next puts the number alone on screen, and the reveal brings it down to a corner', () => {
  const drawn = indexShow({ built: 'now', players: show.players, days: {
    1: [{ index: 1, intl: ['player-intl-1', 'player-intl-2'], usa: ['player-usa-1', 'player-usa-2'] },
      { index: 2, intl: ['player-intl-3', 'player-intl-4'], usa: ['player-usa-3', 'player-usa-4'] }],
    2: [{ index: 1, intl: ['player-intl-5'], usa: ['player-usa-5'] }],
  } });
  let s = initialState(drawn);
  const screen = () => screenPlan(project(s, drawn), drawn);

  s = reduce(s, { name: 'reveal' }, drawn);
  s = reduce(s, { name: 'reveal' }, drawn);
  assert.equal(screen().plan.match.big, false);
  assert.equal(glyphs(screen().plan), '+ VS +');

  s = reduce(s, { name: 'next' }, drawn);
  const between = screen();
  assert.equal(between.screen, 'live', 'the holding screen would say the show has not started');
  assert.deepEqual(between.plan.match, { day: 'Day 1', match: 'Match 2 of 13', big: true });
  assert.equal(between.plan.panels.some((p) => p.visible), false);
  assert.equal(glyphs(between.plan), '+? VS? +?', 'nothing is given away while the number is up');

  s = reduce(s, { name: 'reveal' }, drawn);
  assert.equal(screen().plan.match.big, false, 'the number must get out of the way of the card');
  assert.equal(screen().plan.match.match, 'Match 2 of 13');
  assert.equal(glyphs(screen().plan), '+ VS? +?');

  s = reduce(s, { name: 'setDay', day: 2 }, drawn);
  s = reduce(s, { name: 'goto', index: 0 }, drawn);
  assert.deepEqual(screen().plan.match, { day: 'Day 2', match: 'Match 1 of 26', big: true });
});

// --- screens: one show, several televisions ----------------------------------

const withScreens = (over, screens) => wire({ ...over, screens });

test('a screen with no role, no entry, or a role nobody recognises mirrors the show', () => {
  const live = wire({ mode: 'live' });
  for (const w of [live, { ...live, screens: {} }, { ...live, screens: { main: 'nonsense' } },
    { ...live, screens: null }, { ...live, screens: 'x' }, { ...live, screens: { other: 'hold' } }]) {
    assert.equal(screenPlan(w, show, 'main').screen, 'live', JSON.stringify(w.screens));
    assert.equal(roleOf(w, 'main'), 'mirror');
  }
  // An unknown screen asking is still a screen: it mirrors rather than going dark.
  assert.equal(screenPlan({ ...live, screens: { bar: 'hold' } }, show, 'nobody').screen, 'live');
});

test('a role overrides the show, and mirror follows it', () => {
  const live = wire({ mode: 'live' });
  assert.equal(screenPlan(withScreens({ mode: 'live' }, { bar: 'hold' }), show, 'bar').screen, 'idle');
  assert.equal(screenPlan(withScreens({ mode: 'live' }, { bar: 'slideshow' }), show, 'bar').screen, 'slideshow');
  assert.equal(screenPlan(withScreens({ mode: 'live' }, { bar: 'list' }), show, 'bar').screen, 'list');
  assert.equal(screenPlan(withScreens({ mode: 'live' }, { bar: 'films' }), show, 'bar').screen, 'films');
  assert.equal(screenPlan(withScreens({ mode: 'live' }, { bar: 'mirror' }), show, 'bar').screen, 'live');
  // The show going idle does not reach a screen that is not mirroring.
  assert.equal(screenPlan(withScreens({ mode: 'idle' }, { bar: 'slideshow' }), show, 'bar').screen, 'slideshow');
  assert.equal(screenPlan(withScreens({ mode: 'idle' }, { bar: 'mirror' }), show, 'bar').screen, 'idle');
  // Two screens, one frame: each reads its own line and they disagree on purpose.
  const both = withScreens({ mode: 'live' }, { main: 'mirror', bar: 'list' });
  assert.equal(screenPlan(both, show, 'main').screen, 'live');
  assert.equal(screenPlan(both, show, 'bar').screen, 'list');
  assert.equal(screenPlan(live, show).screen, screenPlan(live, show, DEFAULT_SCREEN).screen);
});

test('a screen name is short, lowercase and harmless, or it is the main screen', () => {
  assert.equal(screenNameFrom('bar'), 'bar');
  assert.equal(screenNameFrom('  BAR  '), 'bar');
  assert.equal(screenNameFrom('back-room-2'), 'back-room-2');
  assert.equal(screenNameFrom(2), '2', 'a numbered screen is a reasonable thing to want');
  for (const bad of ['', null, undefined, 'bar room', '../../etc', '<script>', 'a'.repeat(17),
    '-leading', 'x'.repeat(200), {}, '__proto__', 'bar/../main', 'BÄR']) {
    assert.equal(screenNameFrom(bad), DEFAULT_SCREEN, JSON.stringify(bad));
  }
  // "constructor" is letters and so a legal name; what matters is that it does
  // not read a role off Object's prototype. Same for anything else inherited.
  assert.equal(screenNameFrom('constructor'), 'constructor');
  assert.equal(roleOf({ screens: {} }, 'constructor'), 'mirror');
  assert.equal(roleOf({ screens: { main: 'hold' } }, 'tostring'), 'mirror');
  assert.equal(roleOf({ screens: { constructor: 'hold' } }, 'constructor'), 'hold',
    'a screen really called that still works');
  assert.ok(MAX_SCREENS >= 2 && Number.isInteger(MAX_SCREENS));
  assert.deepEqual(SCREEN_ROLES, ['mirror', 'slideshow', 'films', 'list', 'hold']);
});

// --- player films ------------------------------------------------------------

const filmShow = () => indexShow({
  built: 'now',
  days: { 1: [], 2: [] },
  players: [
    { id: 'a', name: 'A', film: 'cards/a-16x9-web.mp4' },
    { id: 'b', name: 'B', film: null },
    { id: 'c', name: 'C' },
    { id: 'd', name: 'D', film: 'cards/d-16x9-web.mp4' },
  ],
});

test('the films are the players who have one, in roster order, and nothing else', () => {
  const plan = filmList(filmShow());
  assert.deepEqual(plan.films, [
    { playerId: 'a', name: 'A', src: 'cards/a-16x9-web.mp4' },
    { playerId: 'd', name: 'D', src: 'cards/d-16x9-web.mp4' },
  ]);
  // The films come from the show, not the wire: a screen playing them is not
  // moved by the reveal, the match or the slideshow's position.
  const planFor = (w) => screenPlan(w, filmShow(), 'bar');
  const films = (w) => planFor(w).plan.films.map((f) => f.src);
  const w = (over) => withScreens(over, { bar: 'films' });
  assert.deepEqual(films(w({ mode: 'live' })), films(w({ mode: 'idle' })));
  assert.deepEqual(films(w({ mode: 'slideshow' })), films(w({ mode: 'live' })));
  assert.equal(planFor(w({ mode: 'idle' })).screen, 'films', 'an idle show does not stop the films');

  // Nobody with a film is an empty list, not a crash: the stage holds the title card.
  assert.deepEqual(filmList(indexShow({ built: 'now', days: {}, players: [{ id: 'x', name: 'X' }] })).films, []);
  for (const junk of [null, undefined, 'x', 42, {}, { players: 'no' }, { players: [null, 7, {}] }]) {
    assert.doesNotThrow(() => filmList(junk), JSON.stringify(junk));
    assert.deepEqual(filmList(junk).films, [], JSON.stringify(junk));
  }
  // A film path that is not a usable string is no film at all, never "/undefined".
  const odd = filmList({ players: [{ id: 'a', name: 'A', film: '' }, { id: 'b', name: 'B', film: 7 }] });
  assert.deepEqual(odd.films, []);
  // Nobody asked for a film, so there is nowhere for the stage to jump to.
  assert.equal(filmList(filmShow()).cue, null);
});

test('the loop plays the planned order, and never loses a film to it', () => {
  const show = indexShow({
    built: 'now',
    days: { 1: [], 2: [] },
    players: [
      { id: 'a', name: 'A', film: 'cards/a-16x9-web.mp4' },
      { id: 'b', name: 'B', film: 'cards/b-16x9-web.mp4' },
      { id: 'c', name: 'C', film: 'cards/c-16x9-web.mp4' },
    ],
    filmOrder: ['c', 'a', 'b'],
  });
  assert.deepEqual(filmList(show).films.map((f) => f.playerId), ['c', 'a', 'b']);
  // The cue is a position in the PLAYED order, not in the roster.
  assert.equal(filmList(show, { playerId: 'a', seq: 1 }).cue.index, 1);

  // An order that forgets somebody appends them rather than dropping them off
  // the television; one that names a stranger, or the same player twice, ignores it.
  const odd = (filmOrder) => filmList(indexShow({
    built: 'now', days: {}, filmOrder,
    players: [
      { id: 'a', name: 'A', film: 'cards/a-16x9-web.mp4' },
      { id: 'b', name: 'B', film: 'cards/b-16x9-web.mp4' },
    ],
  })).films.map((f) => f.playerId);
  assert.deepEqual(odd(['b']), ['b', 'a'], 'a forgotten film still plays');
  assert.deepEqual(odd(['b', 'nobody', 'a']), ['b', 'a']);
  assert.deepEqual(odd(['a', 'a', 'b']), ['a', 'b'], 'no film plays twice a lap');
  assert.deepEqual(odd([]), ['a', 'b']);
  // Junk where the order should be is roster order, never an exception.
  for (const junk of ['x', 7, {}, null, [null, 7, {}]]) {
    assert.doesNotThrow(() => odd(junk), JSON.stringify(junk));
    assert.deepEqual(odd(junk), ['a', 'b'], JSON.stringify(junk));
  }
});

test('Jump to a film names a position in the list, and only this screen', () => {
  const w = () => withScreens({ mode: 'live' }, { bar: 'films', main: 'films' });
  const cued = (cues) => ({ ...w(), filmCues: cues });

  // D is the second film, because B and C have none: the cue is a position in
  // the films, not a position in the roster.
  const plan = screenPlan(cued({ bar: { playerId: 'd', seq: 3 } }), filmShow(), 'bar').plan;
  assert.deepEqual(plan.cue, { index: 1, seq: 3, playerId: 'd', name: 'D' });
  assert.equal(plan.films[plan.cue.index].src, 'cards/d-16x9-web.mp4');

  // One frame, two screens: a cue reaches the screen it names and no other.
  const one = cued({ bar: { playerId: 'd', seq: 3 } });
  assert.equal(screenPlan(one, filmShow(), 'main').plan.cue, null);

  // The number is what makes a jump an event. It travels untouched, so the
  // stage can tell a new cue from the same one arriving in the next frame.
  for (const seq of [1, 2, 99]) {
    assert.equal(screenPlan(cued({ bar: { playerId: 'a', seq } }), filmShow(), 'bar').plan.cue.seq, seq);
  }

  // A cue the show cannot honour - no such player, a player with no film - is
  // no cue, never an exception and never an index the stage would play blind.
  for (const cue of [{ playerId: 'b', seq: 1 }, { playerId: 'c', seq: 1 }, { playerId: 'nobody', seq: 1 },
    { playerId: 'd', seq: 0 }, { playerId: 'd', seq: 1.5 }, { playerId: 'd' }, { playerId: '', seq: 1 },
    { playerId: 7, seq: 1 }, { seq: 1 }, {}, null, 'd', 7, []]) {
    const got = screenPlan(cued({ bar: cue }), filmShow(), 'bar');
    assert.equal(got.screen, 'films', JSON.stringify(cue));
    assert.equal(got.plan.cue, null, JSON.stringify(cue));
    assert.equal(got.plan.films.length, 2, JSON.stringify(cue));
  }
  // And a wire carrying no cues at all, or nonsense where they should be.
  for (const junk of [undefined, null, 'x', 7, [], { bar: undefined }, { __proto__: { bar: { playerId: 'd', seq: 1 } } }]) {
    assert.doesNotThrow(() => filmCueOf({ filmCues: junk }, 'bar'), JSON.stringify(junk));
    assert.equal(filmCueOf({ filmCues: junk }, 'bar'), null, JSON.stringify(junk));
  }
  assert.equal(filmCueOf(null, 'bar'), null);
  assert.deepEqual(filmCueOf({ filmCues: { bar: { playerId: 'd', seq: 2, junk: 'x' } } }, 'bar'), { playerId: 'd', seq: 2 });
  // A cue is read for the screen asking, by the same name rules as a role.
  assert.deepEqual(filmCueOf({ filmCues: { main: { playerId: 'a', seq: 1 } } }, 'BAD NAME'), { playerId: 'a', seq: 1 });
});

test('the draw list holds the matches revealed so far, and says so when there are none', () => {
  const completed = [
    { day: 1, index: 1, intl: ['player-intl-1', 'player-intl-2'], usa: ['player-usa-1', 'player-usa-2'] },
    { day: 2, index: 4, intl: ['player-intl-3'], usa: ['player-usa-3'] },
  ];
  const plan = drawList(wire({ completed }), show);
  assert.deepEqual(plan.rows.map((r) => r.label), ['1', '4']);
  assert.deepEqual(plan.rows.map((r) => r.day), [1, 2]);
  assert.deepEqual(plan.rows.map((r) => r.intl), ['I1 + I2', 'I3']);
  assert.deepEqual(plan.rows.map((r) => r.usa), ['U1 + U2', 'U3']);
  assert.equal(plan.columns, 1);

  // One column until it would run off the bottom of a television.
  const many = Array.from({ length: 11 }, (_, i) => ({ day: 1, index: i + 1, intl: ['player-intl-1'], usa: ['player-usa-1'] }));
  assert.equal(drawList(wire({ completed: many }), show).columns, 2);
  assert.equal(drawList(wire({ completed: many.slice(0, 10) }), show).columns, 1);

  // Nothing drawn, and junk in the list: an empty plan, never a throw.
  assert.deepEqual(drawList(wire({ completed: [] }), show).rows, []);
  for (const junk of [null, undefined, 'x', { completed: 'no' }]) {
    assert.doesNotThrow(() => drawList(junk, show));
    assert.deepEqual(drawList(junk, show).rows, []);
  }
  // A match whose players the show does not know is left out, not printed as ids.
  const ghosts = drawList(wire({ completed: [{ day: 1, index: 1, intl: ['ghost'], usa: ['nobody'] }] }), show);
  assert.deepEqual(ghosts.rows, []);
});
