// Which clip belongs in which of the four boxes, and is it showing yet.
// Pure, and loaded by both the browser and node --test: no Node-only APIs, no DOM.
//
// Nothing in here may throw on bad input. A thrown exception while planning is a
// black television, and the operator's misclick (same player twice, a blank
// placeholder, an id the show does not know) must only ever make a panel dark.

export const SIDES = ['intl', 'usa'];

// --- screens ----------------------------------------------------------------
// A screen names itself in its own URL: /stage is "main", /stage?screen=bar is
// "bar". The hub imports this file too, so both ends agree on what a name and a
// role are without either guessing.
//
//   mirror     whatever the show says - the default, and what every screen was
//              before there was more than one
//   slideshow  cycles the matches already revealed, whatever the show is doing
//   films      every player's long-form film, back to back and round again
//   photos     photographs from the tournaments gone by, one after another
//   list       the draw so far as text, for people not watching the reveal
//   hold       the gold title card
export const SCREEN_ROLES = ['mirror', 'slideshow', 'films', 'photos', 'list', 'hold'];
export const DEFAULT_SCREEN = 'main';
// /events is public, because the stage has to reach it. That means anyone on the
// venue wifi can invent a screen name; this cap is what stops the console's
// Screens list being filled with junk by someone being funny.
export const MAX_SCREENS = 12;

// Short, lowercase and printable: a name ends up on a button in the console, and
// anything else becomes "main" rather than being rejected - a screen with a
// daft name must still show the show.
export function screenNameFrom(raw) {
  const name = String(raw == null ? '' : raw).trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{0,15}$/.test(name) ? name : DEFAULT_SCREEN;
}

// An unknown screen, an unknown role and a wire with no screens at all all mean
// mirror. Nothing a stranger can type makes a television stop showing the show.
// The whitelist is what makes that true, including for a name like "constructor":
// the hasOwn below is belt and braces and removing it changes no behaviour, so do
// not read it as the thing doing the work.
export function roleOf(wire, name) {
  const screens = wire && wire.screens && typeof wire.screens === 'object' ? wire.screens : null;
  const key = screenNameFrom(name);
  const role = screens && Object.hasOwn(screens, key) ? screens[key] : null;
  return SCREEN_ROLES.includes(role) ? role : 'mirror';
}

// Which film the operator last asked THIS screen to jump to, or null. Same rules
// as roleOf, and for the same reason: anything the wire does not carry properly
// is no cue at all, which leaves the loop running rather than stopping it.
//
// `seq` is what makes a jump an event rather than a setting. The stage honours a
// cue once and remembers the number, so the same cue arriving again in the next
// forty state frames - every reveal sends one - does not restart the film, and
// coming back from Mirror the show still picks up where the loop was.
export function filmCueOf(wire, name) {
  const cues = wire && wire.filmCues && typeof wire.filmCues === 'object' ? wire.filmCues : null;
  const key = screenNameFrom(name);
  const cue = cues && Object.hasOwn(cues, key) ? cues[key] : null;
  if (!cue || typeof cue !== 'object') return null;
  const playerId = typeof cue.playerId === 'string' ? cue.playerId : '';
  const seq = Number.isInteger(cue.seq) && cue.seq > 0 ? cue.seq : 0;
  return playerId === '' || seq === 0 ? null : { playerId, seq };
}

export function formatFor(day) { return day === 1 ? '4x9' : '8x9'; }
export function perSide(day) { return day === 1 ? 2 : 1; }

// How many matches each day holds. Both days restart at 1, so the number alone
// is ambiguous across the night: the day travels with it.
export const DAY_MATCHES = { 1: 13, 2: 26 };

// The match number, and whether it owns the whole screen. `big` is true for
// exactly the condition that used to be a black television: the stage is live
// on a match and nothing in it has been revealed yet. The first reveal docks it.
// Never throws: a day or index the stage cannot make sense of yields empty text,
// which renders as no title rather than as "Match undefined".
export function matchTitle(day, index, shown) {
  const total = Object.hasOwn(DAY_MATCHES, day) ? DAY_MATCHES[day] : null;
  const n = Number.isInteger(index) && index > 0 ? index : null;
  return {
    day: Number.isInteger(day) ? `Day ${day}` : '',
    match: n === null ? '' : (total ? `Match ${n} of ${total}` : `Match ${n}`),
    big: shown !== 'first' && shown !== 'both',
  };
}

// The glyphs that sit in the gaps between panels. `at` is the gap index: gap g
// lies between panel g and panel g+1, so the stage puts it at (g+1)/panels of
// the width and needs no knowledge of the format.
//
// WHEN EACH APPEARS: a partner "+" belongs to its own side and arrives with that
// side's reveal. "VS" waits for the second side, because a VS hung between a card
// and a black half reads as a broken screen rather than as suspense.
export function joinsFor(day, slot) {
  const n = perSide(day);
  const s = slot && typeof slot === 'object' ? slot : {};
  const lit = (side) => s.shown === 'both' || (s.shown === 'first' && side === s.firstSide);
  const joins = [];
  for (let g = 0; g < 2 * n - 1; g++) {
    if (g === n - 1) {
      joins.push({ at: g, glyph: 'VS', kind: 'vs', side: null, visible: s.shown === 'both' });
    } else {
      const side = g < n - 1 ? 'intl' : 'usa';
      joins.push({ at: g, glyph: '+', kind: 'partner', side, visible: lit(side) });
    }
  }
  return joins;
}

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
  return { fmt, panels, match: matchTitle(day, slot.index, slot.shown), joins: joinsFor(day, slot) };
}

// THE STAGE'S GATE, in one place: which of the three screens the TV is showing,
// and, for the live screen, the plan to apply to it. stage.js does what this
// says and decides nothing itself, so the gate can be tested without a DOM.
// Anything that is not live or slideshow is the holding screen, which is why
// every command that puts something on the screen sets mode to live, and why
// `assign`, which puts nothing there yet, deliberately does not (lib/state.mjs).
// `name` is which screen is asking. It defaults to the only screen there used
// to be, so a caller that does not care gets exactly the old behaviour.
export function screenPlan(wire, show, name = DEFAULT_SCREEN) {
  const screen = screenKind(wire, name);
  if (screen === 'films') return { screen, plan: filmList(show, filmCueOf(wire, name)) };
  if (screen === 'photos') return { screen, plan: photoList(show) };
  if (screen === 'list') return { screen, plan: drawList(wire, show) };
  if (screen === 'live') return { screen, plan: panelPlan(wire, show) };
  return { screen, plan: null };          // idle and slideshow carry no plan
}

// WHICH screen a television is on, without building the plan that goes with it.
// screenPlan is the same decision plus the work; this is split out because
// startOffset below has to ask it of every screen at once, and building a draw
// list or a film list for each of them to throw away would be silly.
export function screenKind(wire, name = DEFAULT_SCREEN) {
  const role = roleOf(wire, name);
  if (role === 'hold') return 'idle';
  if (role === 'slideshow') return 'slideshow';
  if (role === 'films') return 'films';
  if (role === 'photos') return 'photos';
  if (role === 'list') return 'list';
  const mode = wire && typeof wire === 'object' ? wire.mode : undefined;
  if (mode === 'slideshow') return 'slideshow';
  if (mode === 'photos') return 'photos';
  if (mode === 'live') return 'live';
  return 'idle';
}

// Where this screen should START in a loop of `n`, so that two televisions
// showing the same thing are not showing the SAME ONE at the same moment.
// Screens on the same kind of screen are spread evenly through the loop: two
// get the top and the middle, three get the thirds, and so on.
//
// Grouped by what each screen is actually SHOWING, not by its role, because a
// screen set to Photos and a mirroring screen following a show in photos mode
// are both playing the same loop and must still be spread apart.
//
// The main screen sorts first and so always draws offset 0. That keeps the one
// television most people are watching starting where it always did, and makes
// this invisible until a second screen exists.
//
// Applied ONCE, when a screen starts its loop - never on a later frame. A
// television already playing must not jump because somebody opened another
// screen in the bar, and two screens that started apart stay apart on their
// own: same film lengths, same dwell.
export function startOffset(wire, name, n) {
  if (!Number.isInteger(n) || n <= 1) return 0;
  const screens = wire && wire.screens && typeof wire.screens === 'object' ? wire.screens : null;
  if (!screens) return 0;
  const me = screenNameFrom(name);
  const kind = screenKind(wire, me);
  const peers = Object.keys(screens)
    .filter((k) => screenKind(wire, k) === kind)
    .sort((a, b) => {
      if (a === DEFAULT_SCREEN) return -1;
      if (b === DEFAULT_SCREEN) return 1;
      return a.localeCompare(b);
    });
  const at = peers.indexOf(me);
  if (at <= 0 || peers.length <= 1) return 0;
  return Math.round((at * n) / peers.length) % n;
}

// The long-form films, in roster order: the thirty-second film each player got,
// one after another and then round again. This is the hour before the pairings
// are announced, so it reads the SHOW and not the wire - no match, no reveal, no
// position - and a screen playing them is unaffected by anything the operator
// does until the role changes.
//
// A player with no film is simply absent (one gave no hometown, so there is
// nowhere to fly to). An empty list is a real answer, and the stage holds the
// title card rather than going black.
//
// `cue` is the operator's Jump to a film…, turned from a player into a position
// in THIS list: the stage knows nothing about who is in the show. A cue naming
// somebody with no film, or nobody at all, resolves to null and the loop simply
// carries on - a jump that cannot be made must not stop the films.
export function filmList(show, cue = null) {
  const players = show && typeof show === 'object' && Array.isArray(show.players) ? show.players : [];
  const films = [];
  for (const p of players) {
    if (!p || typeof p !== 'object') continue;
    if (typeof p.film !== 'string' || p.film === '') continue;
    films.push({
      playerId: typeof p.id === 'string' ? p.id : '',
      name: typeof p.name === 'string' ? p.name : '',
      src: p.film,
    });
  }
  // The loop's running order, planned at build time (build-show.mjs): the sides
  // alternate, no two Internationals of one country and no two US players of one
  // state touch, and it holds where the loop goes round again. Roster order is
  // the fallback, so a show built before this existed still plays - and anyone
  // the order forgets is appended rather than dropped off the television.
  const order = show && Array.isArray(show.filmOrder) ? show.filmOrder : null;
  if (order) {
    const byId = new Map(films.map((f) => [f.playerId, f]));
    const sorted = [];
    for (const id of order) {
      const f = typeof id === 'string' ? byId.get(id) : undefined;
      if (f && !sorted.includes(f)) sorted.push(f);
    }
    for (const f of films) if (!sorted.includes(f)) sorted.push(f);
    films.length = 0;
    films.push(...sorted);
  }
  let at = null;
  if (cue && typeof cue === 'object' && typeof cue.playerId === 'string' && Number.isInteger(cue.seq)) {
    const index = films.findIndex((f) => f.playerId === cue.playerId);
    if (index !== -1) at = { index, seq: cue.seq, playerId: cue.playerId, name: films[index].name };
  }
  return { films, cue: at };
}

// The photographs from tournaments gone by, in the order build-photos.mjs mixed
// them - the years interleave, so the room sees a history rather than one album
// at a time. Read from the SHOW, like the films: nothing the operator does to
// the draw touches a screen that is showing photographs.
//
// An empty list is the ordinary answer when nobody has put any photographs on
// the laptop, and it must stay an answer rather than an error. The stage holds
// the title card, the same as it does for a show with no films.
export function photoList(show) {
  const rows = show && typeof show === 'object' && Array.isArray(show.photos) ? show.photos : [];
  const photos = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    if (typeof row.src !== 'string' || row.src === '') continue;
    photos.push({ src: row.src, year: typeof row.year === 'string' ? row.year : '' });
  }
  return { photos };
}

// The draw so far, as text. A screen set to `list` shows this: every match
// already revealed, in the order they were revealed, so someone at the bar can
// read the whole draw without watching for it. Two columns once a single one
// would run off the bottom of a television.
export function drawList(wire, show) {
  const done = wire && Array.isArray(wire.completed) ? wire.completed : [];
  const names = (list) => (Array.isArray(list) ? list : [])
    .map((id) => lookup(show, id))
    .filter(Boolean)
    .map((p) => (typeof p.name === 'string' ? p.name : ''))
    .filter((n) => n !== '');
  const rows = [];
  for (const m of done) {
    if (!m || typeof m !== 'object') continue;
    const intl = names(m.intl);
    const usa = names(m.usa);
    if (intl.length === 0 && usa.length === 0) continue;
    rows.push({
      key: `${m.day}-${m.index}`,
      day: m.day,
      label: `${m.index}`,
      intl: intl.join(' + '),
      usa: usa.join(' + '),
    });
  }
  return { rows, columns: rows.length > 10 ? 2 : 1 };
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
  // A completed match is shown whole, so every glyph is lit and the number is docked.
  const shown = { shown: 'both', firstSide: 'intl' };
  return { fmt, panels, match: matchTitle(m.day, m.index, 'both'), joins: joinsFor(m.day, shown) };
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
