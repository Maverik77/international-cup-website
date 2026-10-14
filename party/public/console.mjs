// The console's decisions, kept free of the DOM so the tests can reach them.
// operator.js applies them to the page; the same split as panels.mjs / stage.js.
const TEAM_OF = { intl: 'international', usa: 'usa' };
const COUNT = { 1: 13, 2: 26 };

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
  return `Day ${wire.day} · Match ${wire.slot.index} of ${COUNT[wire.day]}`;
}

// How long Next stays shut after it is pressed. Next marks the match done and
// moves on, so a second tap would skip a pairing that never reached the screen.
export const NEXT_LOCK_MS = 1500;

// Sends commands and sorts what comes back into what the operator should see:
//   ok      the new state (handed to onState)
//   note    the hub explained something reasonable (400, 502): shown quietly, as written
//   fault   the hub broke (500) or cannot be reached: loud
//   login   the password no longer works: the page goes back to the login (onLogin)
//   ignored a second Next inside the lock window: nothing was sent
export function createCommandClient({ fetch, onState, onLogin, now = Date.now, nextLockMs = NEXT_LOCK_MS }) {
  let nextOpenAt = 0;

  async function send(command) {
    const isNext = command.name === 'next';
    if (isNext) {
      if (now() < nextOpenAt) return { kind: 'ignored' };
      nextOpenAt = now() + nextLockMs;      // shut before the request leaves, so two taps cannot both go
    }
    let res;
    let body;
    try {
      res = await fetch('/api/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(command),
      });
      body = await res.json();
    } catch {
      if (isNext) nextOpenAt = 0;           // it may never have arrived; let the operator try again
      return { kind: 'fault', message: 'Cannot reach the show. Check the wifi, then try again.' };
    }
    if (res.status === 401 && body && body.needPassword) {
      onLogin();
      return { kind: 'login' };
    }
    if (!body.ok) {
      if (isNext) nextOpenAt = 0;           // refused, so nothing moved
      const message = body.error || 'Something went wrong.';
      return { kind: res.status >= 500 && res.status !== 502 ? 'fault' : 'note', message };
    }
    if (isNext) nextOpenAt = now() + nextLockMs;   // count the window from when it was accepted
    if (body.state) onState(body.state);
    return { kind: 'ok', body };
  }

  return { send, nextLocked: () => now() < nextOpenAt };
}
