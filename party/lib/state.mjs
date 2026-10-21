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

function editCurrentSlot(state, mutate) {
  const next = clone(state);
  mutate(next.slots[String(next.day)][next.current[next.day]]);
  return next;
}

function checkSide(side) {
  if (!SIDES.includes(side)) throw new CommandError('Pick International or USA for that side.');
}

function checkIndex(slots, index, day) {
  if (!Number.isInteger(index) || index < 0 || index >= slots.length) {
    throw new CommandError(`There is no match ${Number.isInteger(index) ? index + 1 : JSON.stringify(index)} on Day ${day}. Pick a match from 1 to ${slots.length}.`);
  }
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
    if (cmd.day !== 1 && cmd.day !== 2) throw new CommandError('The day must be 1 or 2.');
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
    if (day !== 1 && day !== 2) throw new CommandError('The day must be 1 or 2.');
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
    return editCurrentSlot(state, (slot) => { slot.firstSide = cmd.side; });
  },

  assign(state, cmd, show) {
    checkSide(cmd.side);
    const want = sideSize(state.day);
    if (!Array.isArray(cmd.players) || cmd.players.length !== want) {
      throw new CommandError(`Day ${state.day} matches take ${want} player${want === 1 ? '' : 's'} a side, not ${Array.isArray(cmd.players) ? cmd.players.length : 'none'}. Pick again.`);
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
    return editCurrentSlot(state, (slot) => { slot[cmd.side] = [...cmd.players]; });
  },

  reveal(state) {
    const slot = state.slots[String(state.day)][state.current[state.day]];
    // Already fully revealed: a double-tap is harmless, so do nothing at all.
    if (slot.shown === 'both') return NO_CHANGE;
    const next = editCurrentSlot(state, (s) => { s.shown = s.shown === 'none' ? 'first' : 'both'; });
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
    if (cmd.day !== 1 && cmd.day !== 2) throw new CommandError('The day must be 1 or 2.');
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
