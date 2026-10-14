// The console's decisions, kept free of the DOM so the tests can reach them.
// operator.js applies them to the page; the same split as panels.mjs / stage.js.
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
