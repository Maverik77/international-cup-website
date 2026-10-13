// Which clip belongs in which of the four boxes, and is it showing yet.
// Pure, and loaded by both the browser and node --test: no Node-only APIs, no DOM.
//
// Nothing in here may throw on bad input. A thrown exception while planning is a
// black television, and the operator's misclick (same player twice, a blank
// placeholder, an id the show does not know) must only ever make a panel dark.

export const SIDES = ['intl', 'usa'];

export function formatFor(day) { return day === 1 ? '4x9' : '8x9'; }
export function perSide(day) { return day === 1 ? 2 : 1; }

// The browser's copy of the show arrives as JSON, so it has no `byId` until
// stage.js builds one; the tests use build-show's indexed show. Accept either.
const indexCache = new WeakMap();
function lookup(show, id) {
  if (typeof id !== 'string' || id === '' || !show || typeof show !== 'object') return null;
  let index = show.byId;
  if (!index || typeof index !== 'object') {
    index = indexCache.get(show);
    if (!index) {
      index = Object.create(null);
      for (const p of Array.isArray(show.players) ? show.players : []) {
        if (p && typeof p.id === 'string') index[p.id] = p;
      }
      indexCache.set(show, index);
    }
  }
  // hasOwn: an id like "constructor" must not resolve to Object's own members.
  if (!Object.hasOwn(index, id)) return null;
  const player = index[id];
  return player && typeof player === 'object' ? player : null;
}

function clipFor(map, fmt) {
  const src = map && typeof map === 'object' ? map[fmt] : null;
  return typeof src === 'string' && src !== '' ? src : null;
}

function makePanel(show, fmt, side, pos, playerId, visible) {
  const player = lookup(show, playerId);
  const bespoke = player ? clipFor(player.cards, fmt) : null;
  const fallback = player ? clipFor(player.fallback, fmt) : null;
  return {
    key: `${side}-${pos}`,
    side,
    pos,
    playerId: player ? playerId : null,
    name: player && typeof player.name === 'string' ? player.name : '',
    src: bespoke || fallback,
    fallback,
    visible: Boolean(player) && Boolean(visible),
  };
}

const ids = (list) => (Array.isArray(list) ? list : []);

export function panelPlan(wire, show) {
  const day = wire ? wire.day : undefined;
  const fmt = formatFor(day);
  const n = perSide(day);
  const slot = wire && wire.slot && typeof wire.slot === 'object' ? wire.slot : {};
  const panels = [];
  for (const side of SIDES) {
    const revealed = slot.shown === 'both' || (slot.shown === 'first' && side === slot.firstSide);
    const list = ids(slot[side]);
    for (let pos = 0; pos < n; pos++) {
      panels.push(makePanel(show, fmt, side, pos, list[pos], revealed));
    }
  }
  return { fmt, panels };
}

export function panelsForMatch(match, show) {
  const m = match && typeof match === 'object' ? match : {};
  const fmt = formatFor(m.day);
  const n = perSide(m.day);
  const panels = [];
  for (const side of SIDES) {
    const list = ids(m[side]);
    for (let pos = 0; pos < n; pos++) {
      panels.push(makePanel(show, fmt, side, pos, list[pos], true));
    }
  }
  return { fmt, panels };
}

export function preloadSrcs(wire, show) {
  const fmt = formatFor(wire ? wire.day : undefined);
  const next = wire && wire.next && typeof wire.next === 'object' ? wire.next : {};
  const out = [];
  for (const id of [...ids(next.intl), ...ids(next.usa)]) {
    const player = lookup(show, id);
    const src = player ? clipFor(player.cards, fmt) || clipFor(player.fallback, fmt) : null;
    if (src) out.push(src);
  }
  return out;
}

export function slideshowEntry(wire) {
  const all = wire && Array.isArray(wire.completed) ? wire.completed : [];
  if (all.length === 0) return null;
  const raw = wire.slideshow ? wire.slideshow.position : 0;
  const position = Number.isInteger(raw) && raw >= 0 ? raw : 0;
  const entry = all[position % all.length];
  return entry && typeof entry === 'object' ? entry : null;
}

// --- helpers that keep stage.js small and obvious ---------------------------

// Which panels need touching? `applied` holds the playerId each box was last
// loaded with (undefined = never loaded). Only a changed player is touched:
// re-assigning src to the clip already in a box would reload it, and a card
// holding its final frame would flash to black mid-reveal.
export function panelsToLoad(applied, panels) {
  const out = [];
  panels.forEach((panel, i) => {
    const before = applied ? applied[i] : undefined;
    if (before === undefined || before !== panel.playerId) out.push(i);
  });
  return out;
}

// The clip to switch to after `current` failed to play, or null when there is
// nowhere left to go (no fallback, or the failing clip already is the fallback).
// Returning null for the fallback itself is what stops an error loop.
export function srcAfterError(panel, current) {
  if (!panel || !panel.fallback) return null;
  const cur = typeof current === 'string' ? current : '';
  const fb = panel.fallback;
  if (cur === fb || cur.endsWith(`/${fb}`)) return null;
  return fb;
}
