// The show state machine. Pure: reduce() never touches its input.

export class CommandError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CommandError';
  }
}

export const HISTORY_LIMIT = 50;
const SIDES = ['intl', 'usa'];
const MODES = ['idle', 'live', 'slideshow'];
const TEAM_OF = { intl: 'international', usa: 'usa' };
const TEAM_LABEL = { intl: 'International', usa: 'USA' };
const SIDE_OF_TEAM = { international: 'intl', usa: 'usa' };

const clone = (x) => JSON.parse(JSON.stringify(x));

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
    if (show && show.byId) {
      for (const id of count.keys()) {
        if (!show.byId[id]) problems.push(`${id} is not a player in the show`);
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
  if (!SIDES.includes(side)) throw new CommandError(`side must be "intl" or "usa", got ${JSON.stringify(side)}`);
}

function checkIndex(slots, index, day) {
  if (!Number.isInteger(index) || index < 0 || index >= slots.length) {
    throw new CommandError(`there is no match ${Number.isInteger(index) ? index + 1 : JSON.stringify(index)} on day ${day} (matches run 1 to ${slots.length})`);
  }
}

const HANDLERS = {
  setDay(state, cmd) {
    if (cmd.day !== 1 && cmd.day !== 2) throw new CommandError(`day must be 1 or 2, got ${JSON.stringify(cmd.day)}`);
    const next = clone(state);
    next.day = cmd.day;
    return next;
  },

  goto(state, cmd) {
    checkIndex(state.slots[String(state.day)], cmd.index, state.day);
    const next = clone(state);
    next.current[next.day] = cmd.index;
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
      throw new CommandError(`day ${state.day} takes ${want} player${want === 1 ? '' : 's'} a side, got ${Array.isArray(cmd.players) ? cmd.players.length : 'none'}`);
    }
    for (const id of cmd.players) {
      if (id === '') continue; // empty slot: still to be drawn
      const player = typeof id === 'string' ? show.byId?.[id] : undefined;
      if (!player) throw new CommandError(`no player "${id}" in the show`);
      if (player.team !== TEAM_OF[cmd.side]) {
        const actual = SIDE_OF_TEAM[player.team];
        throw new CommandError(`${player.name} plays for ${TEAM_LABEL[actual] ?? player.team}, not ${TEAM_LABEL[cmd.side]}`);
      }
    }
    return editCurrentSlot(state, (slot) => { slot[cmd.side] = [...cmd.players]; });
  },

  reveal(state) {
    const slot = state.slots[String(state.day)][state.current[state.day]];
    if (slot.shown === 'both') {
      throw new CommandError(`match ${slot.index} is already fully revealed; press Next to move on`);
    }
    return editCurrentSlot(state, (s) => { s.shown = s.shown === 'none' ? 'first' : 'both'; });
  },

  next(state) {
    const day = String(state.day);
    const i = state.current[state.day];
    const slots = state.slots[day];
    if (i === slots.length - 1 && slots[i].done) {
      throw new CommandError(`match ${slots[i].index} is the last on day ${state.day} and is already complete`);
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
    if (cmd.day !== 1 && cmd.day !== 2) throw new CommandError(`day must be 1 or 2, got ${JSON.stringify(cmd.day)}`);
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
      throw new CommandError(`mode must be one of ${MODES.join(', ')}, got ${JSON.stringify(cmd.mode)}`);
    }
    const next = clone(state);
    next.mode = cmd.mode;
    if (cmd.mode === 'slideshow') next.slideshow.position = 0;
    return next;
  },

  slideshowGoto(state, cmd) {
    if (!Number.isInteger(cmd.position) || cmd.position < 0) {
      throw new CommandError(`slideshow position must be a whole number from 0, got ${JSON.stringify(cmd.position)}`);
    }
    const next = clone(state);
    next.slideshow.position = cmd.position;
    return next;
  },
};

export function reduce(state, command, show) {
  if (!command || typeof command.name !== 'string') throw new CommandError('command needs a name');

  if (command.name === 'undo') {
    if (state.history.length === 0) throw new CommandError('nothing to undo');
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
    if (!s || typeof s !== 'object' || Array.isArray(s)) throw new CommandError('setSync needs a sync object');
    if ('dirty' in s && typeof s.dirty !== 'boolean') throw new CommandError('sync.dirty must be true or false');
    const next = clone(state);
    next.sync = { ...next.sync, ...clone(s) };
    next.history = state.history.slice();
    next.rev = state.rev + 1;
    return next;
  }

  const handler = Object.hasOwn(HANDLERS, command.name) ? HANDLERS[command.name] : null;
  if (!handler) throw new CommandError(`unknown command "${command.name}"`);

  const next = handler(state, command, show);
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
      problems: slotProblems(slot, state.day, slots, show),
    },
    next: peek ? { intl: [...peek.intl], usa: [...peek.usa] } : { intl: [], usa: [] },
    completed,
    slideshow: { ...state.slideshow },
    sync: { ...state.sync },
  };
}
