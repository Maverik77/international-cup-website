// The show state machine. Pure: reduce() never touches its input.

export class CommandError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CommandError';
  }
}

export const HISTORY_LIMIT = 50;
const SIDES = ['intl', 'usa'];
// `photos` deliberately carries no position of its own, unlike `slideshow`.
// A screen showing photographs owns its own place in the loop, the way a
// screen showing films does, so nothing here has to be saved, undone or
// migrated into a state file written before the mode existed.
const MODES = ['idle', 'live', 'slideshow', 'photos'];
const TEAM_OF = { intl: 'international', usa: 'usa' };
const TEAM_LABEL = { intl: 'International', usa: 'USA' };
const SIDE_OF_TEAM = { international: 'intl', usa: 'usa' };

const NO_CHANGE = Symbol('no change');
const clone = (x) => JSON.parse(JSON.stringify(x));

const hasIndex = (show) => Boolean(show && typeof show === 'object' && show.byId && typeof show.byId === 'object');
const lookup = (show, id) => (typeof id === 'string' && Object.hasOwn(show.byId, id) ? show.byId[id] : undefined);

// A missing index is a programming error (indexShow not called after loading
// JSON), not bad operator input, so it fails fast and loudly.
function assertIndexed(show) {
  if (!hasIndex(show)) {
    throw new Error('This show has no byId index. Call indexShow(show) after loading it from JSON.');
  }
}

export function sideSize(day) { return day === 1 ? 2 : 1; }

export function initialState(show) {
  const slots = {};
  for (const day of ['1', '2']) {
    slots[day] = show.days[day].map((m) => ({
      index: m.index,
      firstSide: 'intl',
      intl: [...m.intl],
      usa: [...m.usa],
      shown: 'none',
      done: false,
    }));
  }
  return {
    version: 1,
    day: 1,
    mode: 'idle',
    current: { 1: 0, 2: 0 },
    slots,
    slideshow: { position: 0, dwellSeconds: 12 },
    sync: { dirty: false, lastPushed: null, lastError: null },
    rev: 0,
    history: [],
  };
}

// Report, never throw: this runs on every projection, and an exception here
// would take the big screen down mid-reveal. `show` is optional; without it
// the unknown-id check is skipped.
export function slotProblems(slot, day, allSlots, show) {
  try {
    const problems = [];
    const ids = (s) => [...(s?.intl || []), ...(s?.usa || [])].filter((id) => typeof id === 'string' && id !== '');
    const here = ids(slot);
    const count = new Map();
    for (const id of here) count.set(id, (count.get(id) || 0) + 1);
    for (const [id, n] of count) {
      if (n > 1) problems.push(`${id} appears twice in this match`);
    }
    if (show !== undefined) {
      if (!hasIndex(show)) {
        problems.push('The show has not been indexed, so players cannot be checked. Reload the app.');
      } else {
        for (const id of count.keys()) {
          if (!lookup(show, id)) problems.push(`${id} is not a player in the show`);
        }
      }
    }
    for (const other of allSlots || []) {
      if (!other || other.index === slot.index) continue;
      const theirs = new Set(ids(other));
      for (const id of count.keys()) {
        if (theirs.has(id)) problems.push(`${id} is already in match ${other.index} on day ${day}`);
      }
    }
    return problems;
  } catch (err) {
    return [`could not check this match (${err?.message || 'unknown error'})`];
  }
}

// The match a command acts on: the one in play unless the command names
// another. Naming one is how a drawing is corrected without putting it on the
// screen - jumping there first would show the room the very match the operator
// is quietly fixing.
function whichSlot(state, cmd) {
  if (cmd.day === undefined && cmd.index === undefined) {
    return { day: state.day, at: state.current[state.day] };
  }
  checkDay(cmd.day);
  checkIndex(state.slots[String(cmd.day)], cmd.index, cmd.day);
  return { day: cmd.day, at: cmd.index };
}

function editSlot(state, at, mutate) {
  const next = clone(state);
  mutate(next.slots[String(at.day)][at.at]);
  return next;
}

function checkSide(side) {
  if (!SIDES.includes(side)) throw new CommandError('Pick International or USA for that side.');
}

function checkDay(day) {
  if (day !== 1 && day !== 2) throw new CommandError('The day must be 1 or 2.');
}

function checkIndex(slots, index, day) {
  if (!Number.isInteger(index) || index < 0 || index >= slots.length) {
    throw new CommandError(`There is no match ${Number.isInteger(index) ? index + 1 : JSON.stringify(index)} on Day ${day}. Pick a match from 1 to ${slots.length}.`);
  }
}

// --- stretches of the night --------------------------------------------------
//
// `undo` steps back one tap, which is the right tool for a mis-tap and the
// wrong one for a stretch of the night that has to be run again: Day 1 is
// thirteen matches and therefore dozens of taps, more than HISTORY_LIMIT holds.
// resetDraw and setAnnounced take a SCOPE instead, and are one undo each
// however many matches they touch.
const DAYS = [1, 2];
const SCOPES = ['all', 'day', 'from', 'match', 'current', 'last'];

// Every match, in the order the night plays them: Day 1's thirteen and then Day
// 2's twenty-six. `at` counts from 0 because the commands do, while the match
// number the operator reads counts from 1.
function nightOrder(state) {
  const out = [];
  for (const day of DAYS) {
    for (let at = 0; at < state.slots[String(day)].length; at++) out.push({ day, at });
  }
  return out;
}

// Whether the night has got to this match yet. Day 1's International pairings
// arrive pre-filled from the running order, so this is not "is there anybody in
// it" - there always is - but "is it still as the show was built".
//
// A side the operator has EMPTIED is the one case that does not count: that is
// a match already put back, which is behind the night rather than ahead of it.
// Without this, resetting a match would make it the last match reached and
// "put the last match back" would never walk backwards past it.
function touched(slot, fresh) {
  if (slot.shown !== 'none' || slot.done) return true;
  if (slot.firstSide !== fresh.firstSide) return true;
  for (const side of SIDES) {
    const now = slot[side] || [];
    const was = fresh[side] || [];
    if (!now.some(Boolean)) continue;
    if (now.length !== was.length || now.some((id, i) => id !== was[i])) return true;
  }
  return false;
}

// Which matches a scope names:
//   all      every match of both days
//   day      every match of cmd.day
//   from     cmd.day/cmd.index and everything after it, Day 1 running on into Day 2
//   match    exactly cmd.day/cmd.index
//   current  the match in play
//   last     the latest match the night has actually reached
//
// `from` crosses from one day into the other on purpose: "everything from here
// onwards" is the evening's own order, and a Day 1 match has the whole of Day 2
// after it.
function matchesIn(state, cmd, show) {
  if (!SCOPES.includes(cmd.scope)) {
    const said = typeof cmd.scope === 'string' ? cmd.scope : JSON.stringify(cmd.scope);
    throw new CommandError(`${said} is not a stretch of the night. Reload the console and try again.`);
  }
  const order = nightOrder(state);
  if (cmd.scope === 'all') return order;
  if (cmd.scope === 'current') return [{ day: state.day, at: state.current[state.day] }];
  if (cmd.scope === 'day') {
    checkDay(cmd.day);
    return order.filter((m) => m.day === cmd.day);
  }
  if (cmd.scope === 'match' || cmd.scope === 'from') {
    checkDay(cmd.day);
    checkIndex(state.slots[String(cmd.day)], cmd.index, cmd.day);
    if (cmd.scope === 'match') return [{ day: cmd.day, at: cmd.index }];
    return order.slice(order.findIndex((m) => m.day === cmd.day && m.at === cmd.index));
  }
  const fresh = initialState(show).slots;
  for (let i = order.length - 1; i >= 0; i--) {
    const m = order[i];
    if (touched(state.slots[String(m.day)][m.at], fresh[String(m.day)][m.at])) return [m];
  }
  throw new CommandError('Nothing has been drawn or announced yet, so there is no last match to put back.');
}

// WHY SOME OF THESE SET mode = 'live': the state starts on `idle`, and the stage
// draws its holding screen - the event title in gold - for any mode that is not
// live or slideshow. A command that PUTS SOMETHING ON THE SCREEN must leave
// idle, or the console says a side is revealed while the TV still shows the
// title: `reveal` does, and `goto` does (the operator has navigated to a match
// and the screen should follow), as `next` and `reopen` already did.
// `assign` deliberately does NOT. It fills a form; nothing is revealed yet, so
// going live would put an empty black layer in front of the room for as long as
// it takes to find two names in a list of 26. Black is indistinguishable from
// broken, which is the whole reason the holding screen shows the event name
// rather than nothing. Only setMode chooses a mode outright.
const HANDLERS = {
  setDay(state, cmd) {
    checkDay(cmd.day);
    if (cmd.day === state.day) return NO_CHANGE;
    const next = clone(state);
    next.day = cmd.day;
    return next;
  },

  // `day` is optional and defaults to the day in play. It exists so that jumping
  // to the other day is ONE command and therefore one Undo: setDay followed by
  // goto would take two taps to reverse, and on the night the operator reaching
  // for Undo is already behind.
  goto(state, cmd) {
    const day = cmd.day === undefined ? state.day : cmd.day;
    checkDay(day);
    checkIndex(state.slots[String(day)], cmd.index, day);
    // Already here AND already on screen: nothing to do. Jumping to the match
    // you are on while the screen is idle is not a no-op: it is the operator
    // saying "show me this one".
    if (day === state.day && cmd.index === state.current[state.day] && state.mode === 'live') return NO_CHANGE;
    const next = clone(state);
    next.day = day;
    next.current[day] = cmd.index;
    next.mode = 'live';
    return next;
  },

  setFirstSide(state, cmd) {
    checkSide(cmd.side);
    return editSlot(state, whichSlot(state, cmd), (slot) => { slot.firstSide = cmd.side; });
  },

  assign(state, cmd, show) {
    checkSide(cmd.side);
    const at = whichSlot(state, cmd);
    const want = sideSize(at.day);
    if (!Array.isArray(cmd.players) || cmd.players.length !== want) {
      throw new CommandError(`Day ${at.day} matches take ${want} player${want === 1 ? '' : 's'} a side, not ${Array.isArray(cmd.players) ? cmd.players.length : 'none'}. Pick again.`);
    }
    for (const id of cmd.players) {
      if (id === '') continue; // empty slot: still to be drawn
      const player = lookup(show, id);
      if (!player) throw new CommandError(`${typeof id === 'string' ? id : JSON.stringify(id)} is not on the roster for this show. Pick someone from the list.`);
      if (player.team !== TEAM_OF[cmd.side]) {
        const actual = SIDE_OF_TEAM[player.team];
        throw new CommandError(`${player.name} plays for ${TEAM_LABEL[actual] ?? player.team}, not ${TEAM_LABEL[cmd.side]}. Pick someone from the ${TEAM_LABEL[cmd.side]} list.`);
      }
    }
    // No mode change on purpose: see the note above HANDLERS.
    return editSlot(state, at, (slot) => { slot[cmd.side] = [...cmd.players]; });
  },

  reveal(state) {
    const slot = state.slots[String(state.day)][state.current[state.day]];
    // Already fully revealed: a double-tap is harmless, so do nothing at all.
    if (slot.shown === 'both') return NO_CHANGE;
    const next = editSlot(state, { day: state.day, at: state.current[state.day] }, (s) => { s.shown = s.shown === 'none' ? 'first' : 'both'; });
    next.mode = 'live';
    return next;
  },

  next(state) {
    const day = String(state.day);
    const i = state.current[state.day];
    const slots = state.slots[day];
    if (i === slots.length - 1 && slots[i].done) {
      // Day 1 ends with 13 of 39 matches done, so name the button that carries
      // the night on rather than leaving the operator looking for it.
      throw new CommandError(state.day === 1
        ? 'Day 1: that was the last match. Tap Day 2 to carry on, or use Undo, or pick another match.'
        : 'Day 2: that was the last match. Use Undo, or pick another match.');
    }
    const next = clone(state);
    const slot = next.slots[day][i];
    slot.done = true;
    slot.shown = 'both';
    if (i < slots.length - 1) next.current[next.day] = i + 1;
    next.mode = 'live';
    return next;
  },

  reopen(state, cmd) {
    checkDay(cmd.day);
    const day = String(cmd.day);
    checkIndex(state.slots[day], cmd.index, cmd.day);
    const next = clone(state);
    next.day = cmd.day;
    next.current[day] = cmd.index;
    next.slots[day][cmd.index].done = false;
    next.mode = 'live';
    return next;
  },

  setMode(state, cmd) {
    if (!MODES.includes(cmd.mode)) {
      throw new CommandError('The screen mode must be idle, live, slideshow or photos.');
    }
    const next = clone(state);
    next.mode = cmd.mode;
    if (cmd.mode === 'slideshow') next.slideshow.position = 0;
    return next;
  },

  slideshowGoto(state, cmd) {
    if (!Number.isInteger(cmd.position) || cmd.position < 0) {
      throw new CommandError('The slideshow position must be a whole number, 0 or more.');
    }
    const next = clone(state);
    next.slideshow.position = cmd.position;
    return next;
  },

  // THESE TWO ARE DELIBERATELY SEPARATE and must stay so. `resetDraw` throws
  // away who was drawn; `setAnnounced` keeps every name and only decides
  // whether the room and the website may read them. On the night those are
  // different mistakes carrying different costs - a mis-drawn match against a
  // match called too early - and one command doing both would make the cheap
  // mistake as frightening to correct as the expensive one.

  // Empties matches: BOTH sides, nothing revealed, International first. The
  // International pairings go with the rest on purpose - putting the running
  // order back instead would mean a match the operator had overridden quietly
  // reverting to a pairing nobody asked for, and a reset is for when the
  // contents of a match are wrong, whichever side is wrong about them. One Undo
  // brings the whole lot back, which is the way back for a reset gone too far.
  resetDraw(state, cmd, show) {
    const targets = matchesIn(state, cmd, show);
    const next = clone(state);
    for (const m of targets) {
      const n = sideSize(m.day);
      next.slots[String(m.day)][m.at] = {
        index: next.slots[String(m.day)][m.at].index,
        firstSide: 'intl',
        intl: Array.from({ length: n }, () => ''),
        usa: Array.from({ length: n }, () => ''),
        shown: 'none',
        done: false,
      };
    }

    // Where the operator is left standing. Their place moves back to the start
    // of the reset only if the reset swallowed it: putting Day 2 back while Day
    // 1 is being drawn must not drag the console off the match in play.
    for (const day of DAYS) {
      const first = targets.find((m) => m.day === day);
      if (first && state.current[day] >= first.at) next.current[day] = first.at;
    }
    if (cmd.scope === 'all') next.day = 1;

    // The match in play has just lost its names, so the stage goes back to the
    // title card. Leaving it live would hold an empty panel in front of the
    // room, and empty is indistinguishable from broken - the same reason the
    // holding screen carries the event name rather than nothing.
    if (targets.some((m) => m.day === state.day && m.at === state.current[state.day])) next.mode = 'idle';
    return next;
  },

  // Who is drawn is untouched; only whether it has been said out loud.
  setAnnounced(state, cmd, show) {
    if (typeof cmd.announced !== 'boolean') {
      throw new CommandError('The console did not say whether those matches are announced. Reload the console and try again.');
    }
    const targets = matchesIn(state, cmd, show);
    const next = clone(state);
    for (const m of targets) {
      const slot = next.slots[String(m.day)][m.at];
      // Both fields, together: `shown` is what the website publishes (see
      // pairings.mjs) and `done` is what the draw-so-far screen lists. A match
      // called back has to leave both, or the room reads it off a television
      // after being told to forget it.
      slot.shown = cmd.announced ? 'both' : 'none';
      slot.done = cmd.announced;
    }
    // Announcing the match in play puts names on the screen, so it must leave
    // idle - see the note above HANDLERS. Calling one back must NOT: the panel
    // stays up and draws the curtain over the names again, which is the point.
    if (cmd.announced && targets.some((m) => m.day === state.day && m.at === state.current[state.day])) {
      next.mode = 'live';
    }
    return next;
  },
};

export function reduce(state, command, show) {
  if (!command || typeof command.name !== 'string') throw new CommandError('The console sent an empty command. Reload the console and try again.');

  assertIndexed(show);

  if (command.name === 'undo') {
    if (state.history.length === 0) throw new CommandError('Nothing to undo.');
    const previous = clone(state.history[state.history.length - 1]);
    return {
      ...previous,
      history: state.history.slice(0, -1),
      // The outbox describes what was pushed, not what was on screen then.
      sync: { ...clone(state.sync), dirty: true },
      rev: state.rev + 1,
    };
  }

  if (command.name === 'setSync') {
    const s = command.sync;
    if (!s || typeof s !== 'object' || Array.isArray(s)) throw new CommandError('The sync status was missing. Reload the console.');
    if ('dirty' in s && typeof s.dirty !== 'boolean') throw new CommandError('The sync status was malformed. Reload the console.');
    const next = clone(state);
    next.sync = { ...next.sync, ...clone(s) };
    next.history = state.history.slice();
    next.rev = state.rev + 1;
    return next;
  }

  const handler = Object.hasOwn(HANDLERS, command.name) ? HANDLERS[command.name] : null;
  if (!handler) throw new CommandError(`The console sent "${command.name}", which the show does not understand. Reload the console.`);

  const next = handler(state, command, show);
  if (next === NO_CHANGE) return state;
  const { history: _drop, ...bare } = clone(state);
  next.history = [...state.history, bare].slice(-HISTORY_LIMIT);
  next.rev = state.rev + 1;
  next.sync = { ...next.sync, dirty: true };
  return next;
}

export function project(state, show) {
  const day = String(state.day);
  const slots = state.slots[day];
  const i = state.current[state.day];
  const slot = slots[i];
  const peek = slots[i + 1];

  const completed = [];
  for (const d of ['1', '2']) {
    for (const s of state.slots[d]) {
      if (s.done) completed.push({ day: Number(d), index: s.index, intl: [...s.intl], usa: [...s.usa] });
    }
  }

  return {
    day: state.day,
    mode: state.mode,
    rev: state.rev,
    rehearsal: Boolean(state.rehearsal),
    slot: {
      index: slot.index,
      firstSide: slot.firstSide,
      intl: [...slot.intl],
      usa: [...slot.usa],
      shown: slot.shown,
      problems: slotProblems(slot, state.day, slots, show ?? {}),
    },
    next: peek ? { intl: [...peek.intl], usa: [...peek.usa] } : { intl: [], usa: [] },
    completed,
    slideshow: { ...state.slideshow },
    sync: { ...state.sync },
  };
}
