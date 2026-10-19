// The console's decisions, kept free of the DOM so the tests can reach them.
// operator.js applies them to the page; the same split as panels.mjs / stage.js.
// Relative, not '/panels.mjs': the same specifier has to resolve in the browser
// and under node --test, and only a relative one does both.
import { SCREEN_ROLES, DEFAULT_SCREEN, filmList, filmCueOf } from './panels.mjs';
const TEAM_OF = { intl: 'international', usa: 'usa' };
const COUNT = { 1: 13, 2: 26 };

export const matchCount = (day) => COUNT[day];

const surname = (name) => name.trim().split(/\s+/).slice(-1)[0].toLowerCase();

// /api/show arrives as plain JSON, so `byId` (non-enumerable on the hub) is
// absent in the browser. Find players either way rather than show an id.
function find(show, id) {
  if (show.byId) return show.byId[id];
  return (show.players || []).find((p) => p.id === id);
}

export function rosterFor(show, side) {
  return show.players
    .filter((p) => p.team === TEAM_OF[side])
    .sort((a, b) => surname(a.name).localeCompare(surname(b.name)));
}

export function nameOf(show, id) {
  if (!id) return '';
  const p = find(show, id);
  return p ? p.name : id;
}

// --- who is already drawn, and where ----------------------------------------
//
// The board comes from the hub's gated /api/board: every slot of both days. It
// never rides on /events, which the public stage reads - that would hand anyone
// on the venue wifi the whole draw before the first reveal.
//
// A player plays once a DAY, not once a night: each day uses all 26 a side, so a
// night-wide rule would hide the entire roster the moment Day 1 finished.
export function takenOnDay(board, day) {
  const where = new Map();
  const matches = board && board.days && typeof board.days === 'object' ? board.days[String(day)] : null;
  if (!Array.isArray(matches)) return where;
  for (const m of matches) {
    if (!m || typeof m !== 'object') continue;
    const ids = [...(Array.isArray(m.intl) ? m.intl : []), ...(Array.isArray(m.usa) ? m.usa : [])];
    for (const id of ids) {
      // First writer wins: a player wrongly in two matches reads as the earlier
      // one, and the problems line is what tells the operator about the clash.
      if (typeof id === 'string' && id !== '' && !where.has(id)) where.set(id, m.index);
    }
  }
  return where;
}

// The picker's list. `holding` is whoever already sits in the slot being edited:
// they stay on the list however it is filtered, because otherwise replacing a
// player would mean emptying the slot first. `hidden` counts what the picked
// rule took out, so the toggle can say how many are behind it.
export function pickerRows(show, { side, board, day, holding = '', current, showPicked = false, query = '' } = {}) {
  const taken = takenOnDay(board, day);
  const q = String(query == null ? '' : query).trim().toLowerCase();
  const rows = [];
  let hidden = 0;
  for (const p of rosterFor(show, side)) {
    if (q && !p.name.toLowerCase().includes(q)) continue;
    const at = taken.get(p.id);
    const picked = at !== undefined && p.id !== holding;
    if (picked && !showPicked) { hidden += 1; continue; }
    rows.push({
      id: p.id,
      name: p.name,
      picked,
      holding: p.id === holding,
      where: picked ? (at === current ? 'already in this match' : `already in match ${at}`) : '',
    });
  }
  return { rows, hidden };
}

// "Ashvini Anjutgi + Vijay Davuluri vs John Altman + Frank Ambrose", or '' when
// nothing has been drawn yet. Full names on purpose: this roster has two Baes,
// two Vosburghs and a Chris and a Chrissy Crouse, so a surname names nobody.
export function matchNames(show, match) {
  const side = (list) => (Array.isArray(list) ? list : [])
    .filter((id) => typeof id === 'string' && id !== '')
    .map((id) => nameOf(show, id));
  const intl = side(match && match.intl);
  const usa = side(match && match.usa);
  if (intl.length === 0 && usa.length === 0) return '';
  const join = (xs) => (xs.length ? xs.join(' + ') : '—');
  return `${join(intl)} vs ${join(usa)}`;
}

// Jump to… both days at once, each match carrying whoever is already in it.
// `index` counts from 0 because the commands do; `label` counts from 1 because
// the operator does.
export function jumpSections(show, board) {
  const b = board && typeof board === 'object' ? board : {};
  return ['1', '2'].map((d) => {
    const day = Number(d);
    const matches = b.days && Array.isArray(b.days[d]) ? b.days[d] : [];
    return {
      day,
      title: `Day ${day}`,
      rows: matches.map((m, i) => ({
        day,
        index: i,
        label: `Match ${m && Number.isInteger(m.index) ? m.index : i + 1}`,
        names: matchNames(show, m),
        done: Boolean(m && m.done),
        current: b.day === day && Boolean(b.current) && b.current[d] === i,
      })),
    };
  });
}

const clock = (iso) => new Date(iso).toTimeString().slice(0, 8);

export function syncLabel(sync) {
  if (sync.lastError) {
    return sync.lastPushed
      ? { text: `Offline — last synced ${clock(sync.lastPushed)}`, tone: 'offline' }
      : { text: 'Offline — never synced', tone: 'offline' };
  }
  if (sync.dirty) return { text: 'Syncing…', tone: 'pending' };
  if (!sync.lastPushed) return { text: 'Sync off', tone: 'ok' };
  return { text: `Synced ${clock(sync.lastPushed)}`, tone: 'ok' };
}

export function describeProblems(problems, show) {
  return (problems || []).map((text) =>
    text.replace(/player-(intl|usa)-\d+/g, (id) => nameOf(show, id)));
}

export function slotLabel(wire) {
  return `Day ${wire.day} · Match ${wire.slot.index} of ${matchCount(wire.day)}`;
}

// How long Next stays shut after it is pressed. Next marks the match done and
// moves on, so a second tap would skip a pairing that never reached the screen.
export const NEXT_LOCK_MS = 1500;
// A slow hub must not be outrun: a Next still unanswered blocks another, but only
// this long, so a hung request can never strand the operator.
export const NEXT_FLIGHT_CAP_MS = 10000;

// The sentence shown when the hub came up without the saved state. Silently
// starting from match 1 mid-show is the worst case, so it names the reason and the way back.
// Uses the summary only: `recoveredReason` carries a file path and a parse error
// for the laptop's terminal, and must never reach the iPad, not even as a fallback.
export function recoveredBanner(who) {
  if (!who || !who.recovered) return null;
  const what = who.recoveredSummary ? ` ${String(who.recoveredSummary).trim()}` : '';
  return `The show started over from Day 1, match 1.${what} If you were part-way through, use Jump to… to get back to your match.`;
}

// Where an unrecognised-session operator is sent.
export const LOGIN_PATH = '/operator';

// Keeps trying until the console's first load works; each failure is reported
// and waited out, never swallowed.
export async function loadUntilReady({ load, onReady, onFail, wait }) {
  for (;;) {
    try {
      const loaded = await load();
      onReady(loaded);
      return loaded;
    } catch (e) {
      onFail(e);
      await wait();
    }
  }
}

// Sends commands and sorts what comes back into what the operator should see:
//   ok      the new state (handed to onState)
//   note    the hub explained something reasonable (400, 502): shown quietly, as written
//   fault   the hub broke (500) or cannot be reached: loud
//   login   the password no longer works: the page goes back to the login (onLogin)
//   ignored a second Next inside the lock window: nothing was sent
export function createCommandClient({ fetch, onState, onLogin, now = Date.now, nextLockMs = NEXT_LOCK_MS }) {
  let nextOpenAt = 0;
  let nextSentAt = -Infinity;   // when a Next that has not been answered yet left
  let nextToken = 0;            // which Next is the live one; only its reply may touch the lock
  let nextPending = false;
  const inFlight = () => nextPending && now() - nextSentAt < NEXT_FLIGHT_CAP_MS;

  async function send(command) {
    const isNext = command.name === 'next';
    if (isNext) {
      if (inFlight() || now() < nextOpenAt) return { kind: 'ignored' };
      nextToken += 1;
      nextPending = true;
      nextSentAt = now();
      nextOpenAt = now() + nextLockMs;      // shut before the request leaves, so two taps cannot both go
    }
    const mine = nextToken;      // a stale Next (answered after the cap) must not clear a newer one's lock
    const current = () => isNext && mine === nextToken;
    try {
      let res;
      let body;
      try {
        res = await fetch('/api/command', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(command),
        });
        // A 401 is the login's business whatever its body looks like.
        body = res.status === 401 ? null : await res.json();
      } catch {
        if (current()) nextOpenAt = 0;        // it may never have arrived; let the operator try again
        return { kind: 'fault', message: 'Cannot reach the show. Check the wifi, then try again.' };
      }
      if (res.status === 401) {
        onLogin();
        return { kind: 'login' };
      }
      if (!body || !body.ok) {
        if (current()) nextOpenAt = 0;        // refused, so nothing moved
        const message = (body && body.error) || 'Something went wrong.';
        return { kind: res.status >= 500 && res.status !== 502 ? 'fault' : 'note', message };
      }
      if (current()) nextOpenAt = now() + nextLockMs;   // count the window from when it was accepted
      if (body.state) onState(body.state);
      return { kind: 'ok', body };
    } finally {
      if (current()) nextPending = false;
    }
  }

  return { send, nextLocked: () => inFlight() || now() < nextOpenAt };
}

// --- screens -----------------------------------------------------------------

// What each role is called on a button. Keyed by SCREEN_ROLES, so a role added
// in panels.mjs without a label here fails the console's own test rather than
// reaching the night as a blank button.
export const SCREEN_ROLE_LABELS = {
  mirror: 'Mirror the show',
  slideshow: 'Slideshow',
  films: 'Player films',
  list: 'Draw so far',
  hold: 'Title card',
};

export const SCREEN_ROLE_HINTS = {
  mirror: 'Shows exactly what the main screen shows.',
  slideshow: 'Cycles the matches already revealed.',
  films: 'Every player film, one after another, round and round.',
  list: 'The whole draw so far, as text.',
  hold: 'The gold title card, and nothing else.',
};

// "Mirror the show, Slideshow, Player films, Draw so far or Title card" - the
// choices, written out, for the hub to put in its refusal. Built from the labels
// so a role added in panels.mjs cannot drift out of the sentence the operator reads.
export function screenRoleChoices() {
  const labels = SCREEN_ROLES.map((role) => SCREEN_ROLE_LABELS[role]).filter(Boolean);
  if (labels.length <= 1) return labels.join('');
  return `${labels.slice(0, -1).join(', ')} or ${labels[labels.length - 1]}`;
}

// One row per screen that has connected. Main first, then by name, so the list
// never reorders itself under the operator's finger as screens come and go.
export function screenRows(wire) {
  const screens = wire && wire.screens && typeof wire.screens === 'object' ? wire.screens : {};
  const names = Object.keys(screens);
  names.sort((a, b) => {
    if (a === DEFAULT_SCREEN) return -1;
    if (b === DEFAULT_SCREEN) return 1;
    return a.localeCompare(b);
  });
  return names.map((name) => ({
    name,
    role: SCREEN_ROLES.includes(screens[name]) ? screens[name] : 'mirror',
    label: name === DEFAULT_SCREEN ? 'Main screen' : name,
    roles: SCREEN_ROLES.map((role) => ({ role, label: SCREEN_ROLE_LABELS[role], hint: SCREEN_ROLE_HINTS[role] })),
    // The film this screen was last sent to, so the dialog can say so. The hub
    // does not know where the loop has got to since - only where it was sent -
    // which is why this says "jumped to" and not "now playing".
    cue: filmCueOf(wire, name),
  }));
}

// Jump to a film…: every player who has one, by side and then by surname. The
// loop's own order is roster order, which is grouped by country and no use for
// finding a person on a list of thirty-nine. `cued` is whoever this screen was
// last sent to, so the operator can see what they last picked.
//
// A side with nobody left after the filter is dropped rather than left as a
// heading with nothing under it; both sides empty is a real answer, and the
// dialog says so.
export function filmSections(show, { query = '', cued = '' } = {}) {
  const q = String(query == null ? '' : query).trim().toLowerCase();
  const withFilm = new Set(filmList(show).films.map((f) => f.playerId));
  return [['intl', 'International'], ['usa', 'USA']].map(([side, title]) => ({
    side,
    title,
    rows: rosterFor(show, side)
      .filter((p) => withFilm.has(p.id))
      .filter((p) => !q || p.name.toLowerCase().includes(q))
      .map((p) => ({ playerId: p.id, name: p.name, cued: p.id === cued })),
  })).filter((section) => section.rows.length > 0);
}

// Whether Sync would change anything, so the button can say so rather than
// looking broken when it is pressed and nothing moves.
export function screensInSync(wire) {
  return screenRows(wire).every((row) => row.role === 'mirror');
}

// What the Screens button says on the main console. A screen that has wandered
// off the show is worth noticing without opening the dialog.
export function screensLabel(wire) {
  const rows = screenRows(wire);
  const off = rows.filter((row) => row.role !== 'mirror').length;
  return off === 0 ? 'Screens…' : `Screens… (${off} off the show)`;
}
