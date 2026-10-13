import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync, renameSync } from 'node:fs';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { loadRoster } from './roster.mjs';
import { buildGenericCard } from './generic-card.mjs';
import { DEFAULT_FLAGS_DIR } from './fetch-flags.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PARTY = resolve(HERE, '..');
const REPO = resolve(PARTY, '..');
const CARD_KEYS = JSON.parse(readFileSync(join(HERE, 'card-keys.json'), 'utf8'));

export const DAY1_MATCHES = 13;
export const DAY2_MATCHES = 26;
export const FORMATS = ['4x9', '8x9'];
export const EXPECTED_SIZE = { '4x9': [480, 1080], '8x9': [960, 1080] };
// Every card we make or were given runs 8-9s. Outside this range something is wrong.
export const MIN_SECONDS = 3;
export const MAX_SECONDS = 30;

export class BuildError extends Error {}

export function indexShow(show) {
  Object.defineProperty(show, 'byId', {
    value: Object.fromEntries(show.players.map((p) => [p.id, p])),
    enumerable: false, configurable: true,
  });
  return show;
}

// Decide every player's filenames. A player with a bespoke card keeps its
// nickname-based name; everyone else gets a flag card named by id. Every player
// also gets a flag card as `fallback`, so a broken bespoke clip has somewhere to go.
export function planCards(players, cardsDir, cardKeys = CARD_KEYS) {
  const byName = new Map(players.map((p) => [p.name, p]));
  for (const name of Object.keys(cardKeys)) {
    if (!byName.has(name)) {
      throw new BuildError(
        `party/build/card-keys.json names "${name}", who is not on the roster. ` +
        `Fix the spelling or remove the entry.`,
      );
    }
  }
  return players.map((p) => {
    const key = cardKeys[p.name];
    const fallback = { '4x9': `cards/${p.id}-4x9.mp4`, '8x9': `cards/${p.id}-8x9.mp4` };
    if (!key) return { ...p, generic: true, cards: { ...fallback }, fallback };
    const cards = { '4x9': `cards/${key}-4x9.mp4`, '8x9': `cards/${key}-8x9.mp4` };
    const absent = FORMATS.filter((f) => !existsSync(join(cardsDir, `${key}-${f}.mp4`)));
    if (absent.length) {
      // Silently downgrading would put a flag where a face should be.
      throw new BuildError(
        `card-keys.json maps "${p.name}" to "${key}", but cards/${key}-${absent.join(', ')} is missing. ` +
        `Add the file or remove the entry.`,
      );
    }
    return { ...p, generic: false, cards, fallback };
  });
}

// Default prober: opens the file with ffprobe. Throws ProbeUnavailable if there is no ffprobe,
// a plain Error if the file cannot be read as video.
export class ProbeUnavailable extends Error {}

export function ffprobeCard(abs) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=codec_type,width,height:format=duration', '-of', 'json', abs],
  { encoding: 'utf8', timeout: 30_000 });
  if (r.error) {
    if (r.error.code === 'ENOENT') throw new ProbeUnavailable('ffprobe was not found on PATH');
    throw new Error(`ffprobe failed: ${r.error.message}`);
  }
  if (r.status !== 0) throw new Error(`ffprobe could not read it: ${(r.stderr || '').trim().split('\n')[0] || 'unknown error'}`);
  let j;
  try { j = JSON.parse(r.stdout); } catch { throw new Error('ffprobe gave unreadable output'); }
  const s = j.streams && j.streams[0];
  if (!s) throw new Error('it has no video stream');
  return { width: s.width, height: s.height, duration: Number(j.format && j.format.duration) };
}

// `root` is the directory that holds `cards/` (the party directory), because
// the paths recorded in the show are relative to it, e.g. 'cards/seth-4x9.mp4'.
export function validateCards(show, root, { probe = ffprobeCard } = {}) {
  const problems = [];
  const seen = new Set();
  let unavailable = false;
  for (const p of show.players) {
    for (const fmt of FORMATS) {
      const paths = [p.cards && p.cards[fmt], p.fallback && p.fallback[fmt]].filter(Boolean);
      for (const rel of paths) {
        if (seen.has(rel)) continue;
        seen.add(rel);
        const abs = join(root, rel);
        if (!existsSync(abs)) { problems.push(`${p.name}: missing ${rel}`); continue; }
        if (statSync(abs).size === 0) { problems.push(`${p.name}: zero-length ${rel}`); continue; }
        if (unavailable) continue;
        let info;
        try {
          info = probe(abs);
        } catch (e) {
          if (e instanceof ProbeUnavailable) {
            unavailable = true;
            problems.push(`cannot validate cards: ${e.message}. Install ffmpeg (which includes ffprobe); ` +
              `files that exist have NOT been checked for playability`);
          } else {
            problems.push(`${p.name}: unreadable ${rel} (${e.message})`);
          }
          continue;
        }
        const [w, h] = EXPECTED_SIZE[fmt];
        if (info.width !== w || info.height !== h) {
          problems.push(`${p.name}: ${rel} is ${info.width}x${info.height}, expected ${w}x${h}`);
        } else if (!Number.isFinite(info.duration) || info.duration < MIN_SECONDS || info.duration > MAX_SECONDS) {
          problems.push(`${p.name}: ${rel} has implausible duration ${info.duration}s ` +
            `(expected ${MIN_SECONDS}-${MAX_SECONDS}s)`);
        }
      }
    }
  }
  return problems;
}

function buildDays(players, runningOrder) {
  const intl = players.filter((p) => p.team === 'international').map((p) => p.id);
  const usa = players.filter((p) => p.team === 'usa').map((p) => p.id);
  if (intl.length !== 26 || usa.length !== 26) {
    throw new BuildError(`expected 26 players a side, got ${intl.length} international and ${usa.length} USA`);
  }
  const intlSet = new Set(intl);
  const preset = new Map();
  for (const m of runningOrder?.days?.['1'] || []) {
    const ids = m.intl;
    if (!Array.isArray(ids) || ids.length !== 2 || ids.some((id) => !intlSet.has(id))) {
      throw new BuildError(`running-order.json: Day 1 match ${m.index} must name two International player ids, got ${JSON.stringify(ids)}`);
    }
    preset.set(m.index, ids);
  }
  const day1 = [];
  for (let i = 1; i <= DAY1_MATCHES; i++) {
    day1.push({ index: i, intl: [...(preset.get(i) || [intl[(i - 1) * 2], intl[(i - 1) * 2 + 1]])], usa: ['', ''] });
  }
  const day2 = [];
  for (let i = 1; i <= DAY2_MATCHES; i++) day2.push({ index: i, intl: [intl[i - 1]], usa: [''] });
  return { 1: day1, 2: day2 };
}

// cardsDir must be a directory named `cards`; the show records paths as 'cards/<file>'.
// manifestOnly builds and returns the Show without generating, validating or writing anything.
// buildCard and probe are injectable for tests.
export async function buildShow({
  detailsPath = join(REPO, 'contacts/player-details.json'),
  cardsDir = join(PARTY, 'cards'),
  flagsDir = DEFAULT_FLAGS_DIR,
  runningOrderPath = join(PARTY, 'running-order.json'),
  onProgress = () => {},
  outPath = join(PARTY, 'show.json'),
  manifestOnly = false,
  buildCard = buildGenericCard,
  probe = ffprobeCard,
  cardKeys = CARD_KEYS,
} = {}) {
  cardsDir = resolve(cardsDir);
  if (basename(cardsDir) !== 'cards') {
    throw new BuildError(`cardsDir must be a directory named "cards" (got ${cardsDir}); the show records paths as cards/<file>`);
  }
  const root = dirname(cardsDir);
  const players = planCards(loadRoster(detailsPath), cardsDir, cardKeys);
  const runningOrder = existsSync(runningOrderPath)
    ? JSON.parse(readFileSync(runningOrderPath, 'utf8')) : null;
  const show = indexShow({ built: new Date().toISOString(), players, days: buildDays(players, runningOrder) });
  if (manifestOnly) return show;

  mkdirSync(cardsDir, { recursive: true });
  // Flag cards for everyone, bespoke players included: it is what a broken bespoke clip falls back to.
  const todo = [];
  for (const p of players) {
    for (const format of FORMATS) {
      const abs = join(root, p.fallback[format]);
      if (!existsSync(abs) || statSync(abs).size === 0) todo.push({ player: p, format, outPath: abs });
    }
  }
  onProgress(`generating ${todo.length} flag cards`);
  for (const [n, job] of todo.entries()) {
    await buildCard({ ...job, flagsDir, workDir: cardsDir });
    onProgress(`  [${n + 1}/${todo.length}] ${job.player.name} ${job.format}`);
  }

  const problems = validateCards(show, root, { probe });
  if (problems.length) {
    throw new BuildError(`the show is not playable:\n  ${problems.join('\n  ')}`);
  }
  if (outPath) {
    mkdirSync(dirname(outPath), { recursive: true });
    const tmp = `${outPath}.tmp`;
    writeFileSync(tmp, JSON.stringify(show, null, 2));
    renameSync(tmp, outPath);
  }
  return show;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const show = await buildShow({ onProgress: (m) => console.log(m) });
    const generic = show.players.filter((p) => p.generic).length;
    console.log(`\nparty/show.json: ${show.players.length} players ` +
      `(${show.players.length - generic} bespoke, ${generic} flag cards), ` +
      `${show.days[1].length} team matches, ${show.days[2].length} singles.`);
    console.log('Reminder: show.json is gitignored. It carries details for people who said no to the website.');
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
