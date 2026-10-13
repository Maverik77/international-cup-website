import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  formatFor, perSide, panelPlan, panelsForMatch, preloadSrcs, slideshowEntry,
  panelsToLoad, srcAfterError,
} from '../public/panels.mjs';
import { indexShow } from '../build/build-show.mjs';

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
    intl: ['player-intl-ghost', 'player-intl-2'], usa: ['player-intl-ghost', ''],
    problems: ['player-usa-1 appears twice in this match'], shown: 'both',
  }), show);
  for (const p of plan.panels) {
    assert.doesNotMatch(p.name, /player-/);
    assert.equal(typeof p.name, 'string');
  }
  // slot.problems carries ids; the plan must not pass them on
  assert.doesNotMatch(JSON.stringify(plan.panels.map(({ name, visible }) => ({ name, visible }))), /player-/);
  assert.equal(plan.problems, undefined);
  // and the stage source never reads problems at all
  const stageJs = readFileSync(new URL('../public/stage.js', import.meta.url), 'utf8');
  assert.doesNotMatch(stageJs, /problems/);
  const stageHtml = readFileSync(new URL('../public/stage.html', import.meta.url), 'utf8');
  assert.doesNotMatch(stageHtml, /problems/);
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

test('the stage has a static idle screen so a working idle is not mistaken for a dead one', () => {
  const html = readFileSync(new URL('../public/stage.html', import.meta.url), 'utf8');
  assert.match(html, /<div id="idle"><p>International Cup<\/p><\/div>/);
  const js = readFileSync(new URL('../public/stage.js', import.meta.url), 'utf8');
  assert.match(js, /classList\.add\('idle'\)/);
});
