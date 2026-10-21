// Persistence for the live show state.
//
// Restarting the hub is the recovery procedure for a slept or unplugged
// laptop, so (1) a write must never leave a half-written state.json and
// (2) a load must never throw because of what is on disk.
//
// `fs` is used as a namespace object (not destructured) so tests can observe
// and fail individual calls.
import fs from 'node:fs';
import { dirname } from 'node:path';
import { initialState, sideSize } from './state.mjs';

const MODES = ['idle', 'live', 'slideshow', 'photos'];
const SHOWN = ['none', 'first', 'both'];
const SIDES = ['intl', 'usa'];
// Errors that mean "this platform/filesystem cannot fsync a directory".
const DIR_SYNC_UNSUPPORTED = new Set(['EINVAL', 'EPERM', 'EISDIR', 'ENOTSUP', 'EBADF', 'EACCES']);

// Atomic: write <path>.tmp beside the target, fsync it, rename over the
// target, then fsync the directory so the rename itself is durable. Readers
// see the old complete file or the new complete file, never a mixture, and a
// failure at any step leaves the previous file untouched. Throws on failure:
// the caller must know the state is not safely on disk.
export function saveState(path, state) {
  const tmp = `${path}.tmp`;
  const body = JSON.stringify(state);
  try {
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.writeSync(fd, body);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, path);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch { /* nothing to clean up */ }
    throw err;
  }
  syncDirectory(dirname(path));
}

function syncDirectory(dir) {
  let fd;
  try {
    fd = fs.openSync(dir, 'r');
    fs.fsyncSync(fd);
  } catch (err) {
    if (!DIR_SYNC_UNSUPPORTED.has(err?.code)) throw err;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

// Move a bad file aside as <path>.corrupt-<timestamp>, never overwriting an
// earlier one: two crashes in a row must leave two files of evidence.
function setAside(path) {
  const stamp = new Date(Date.now()).toISOString().replace(/[:.]/g, '-');
  const base = `${path}.corrupt-${stamp}`;
  let dest = base;
  for (let n = 1; fs.existsSync(dest); n += 1) dest = `${base}-${n}`;
  try {
    fs.renameSync(path, dest);
    return { dest, note: `The old file was kept as ${dest}.` };
  } catch (err) {
    return { dest: null, note: `It could not be moved aside (${err.code || err.message}).` };
  }
}

const isInt = (n) => Number.isInteger(n);
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

// Returns a problem description, or null if `s` is a usable state for `show`.
function stateProblem(s, show) {
  if (!isObj(s)) return 'it is not a party state file (expected a JSON object)';
  // A file with no version at all is not one of ours; a file with a different
  // one was ours once. The version number itself goes in the detail, so the
  // terminal keeps it and the operator's iPad is not asked to read
  // "version undefined, expected 1".
  if (s.version === undefined) return 'it is not a party state file (no version in it)';
  if (s.version !== 1) {
    return { why: 'it was saved by a different version of this tool', detail: `version ${JSON.stringify(s.version)}, expected 1` };
  }
  if (s.day !== 1 && s.day !== 2) return 'it is not a party state file (day is missing or not 1 or 2)';
  if (!MODES.includes(s.mode)) return 'it is not a party state file (unknown screen mode)';
  if (!isObj(s.slots) || !Array.isArray(s.slots['1']) || !Array.isArray(s.slots['2'])) {
    return 'it is not a party state file (match slots are missing)';
  }
  if (!isObj(s.current)) return 'it is not a party state file (current match is missing)';
  if (!isObj(s.sync)) return 'it is not a party state file (sync info is missing)';
  if (!isObj(s.slideshow) || !isInt(s.slideshow.position)) return 'it is not a party state file (slideshow info is missing)';
  if (!isInt(s.rev)) return 'it is not a party state file (revision number is missing)';

  for (const day of ['1', '2']) {
    const have = s.slots[day].length;
    const want = show?.days?.[day]?.length;
    if (have !== want) {
      return `slot count does not match the show (Day ${day} has ${have} matches saved but the show has ${want}) - the show was rebuilt`;
    }
    if (!isInt(s.current[day]) || s.current[day] < 0 || s.current[day] >= have) {
      return `it is not a party state file (current match for Day ${day} is out of range)`;
    }
    const size = sideSize(Number(day));
    for (const slot of s.slots[day]) {
      const ok = isObj(slot) && SIDES.includes(slot.firstSide) && SHOWN.includes(slot.shown)
        && typeof slot.done === 'boolean'
        && SIDES.every((side) => Array.isArray(slot[side]) && slot[side].length === size
          && slot[side].every((id) => typeof id === 'string'));
      if (!ok) return `it is not a party state file (a Day ${day} match is malformed)`;
    }
  }
  return null;
}

// `show` must already be indexed (indexShow attaches byId non-enumerably, so
// it does not survive JSON.parse). Index once at startup; this does not.
export function loadState(path, show) {
  let text;
  try {
    text = fs.readFileSync(path, 'utf8');
  } catch (err) {
    if (err?.code === 'ENOENT') return { state: initialState(show), recovered: false, reason: null, summary: null };
    // Unreadable (permissions, a directory...): still start, say why.
    const aside = setAside(path);
    return {
      state: initialState(show),
      recovered: true,
      // `reason` is for the terminal and keeps the errno; `summary` is for the iPad and does not.
      reason: `The state file could not be read (${err?.code || err?.message}), so the show started fresh. ${aside.note}`,
      summary: 'The saved show state could not be read, so the show started fresh.',
    };
  }

  // `why` is plain English and goes to both surfaces. `detail` (a parse error)
  // and the aside note (a file path) go to `reason` only: the laptop's terminal.
  const fail = (why, detail) => {
    const aside = setAside(path);
    const lead = `The saved show state was unusable, so the show started fresh: ${why}`;
    return {
      state: initialState(show),
      recovered: true,
      reason: `${lead}${detail ? ` (${detail})` : ''}. ${aside.note}`,
      summary: `${lead}.`,
    };
  };

  if (text.trim() === '') return fail('the file was empty (the laptop probably lost power during a save)');

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return fail('bad JSON, probably cut off mid-save', err.message);
  }

  // stateProblem returns a plain string, or { why, detail } when it has a value
  // that belongs in the terminal but not on the iPad.
  const problem = stateProblem(parsed, show);
  if (problem) return typeof problem === 'string' ? fail(problem) : fail(problem.why, problem.detail);

  if (!Array.isArray(parsed.history)) parsed.history = [];
  return { state: parsed, recovered: false, reason: null, summary: null };
}
