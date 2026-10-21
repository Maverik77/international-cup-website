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
// Browsers play h264 in either pixel format. Real bespoke cards include yuvj420p
// (full-range) and play fine, so both are accepted; anything else is not.
export const PIX_FMTS = ['yuv420p', 'yuvj420p'];
export const MIN_SECONDS = 3;
export const MAX_SECONDS = 30;
// The long-form films are a different animal from the cards: 1920x1080, half a
// minute, and optional - a player with no hometown has nowhere to fly to, so
// there is no film and a screen showing them leaves that player out.
export const FILM_SIZE = [1920, 1080];
export const FILM_MIN_SECONDS = 20;
export const FILM_MAX_SECONDS = 40;

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
// The film the stage plays, or null. The `-web` variant on purpose: it is the
// same picture at ~4 Mbps, and a loop of the masters is a gigabyte over venue
// wifi. Having no film at all is legitimate, so that returns null rather than
// throwing. A file that is there but empty is a different thing - a half-finished
// encode - and is named anyway, so the validator below refuses it rather than
// letting a black half-minute reach a television.
function filmFor(key, cardsDir) {
  if (!key) return null;
  const name = `${key}-16x9-web.mp4`;
  const abs = join(cardsDir, name);
  if (!existsSync(abs)) return null;
  return `cards/${name}`;
}

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
    const film = filmFor(key, cardsDir);
    if (!key) return { ...p, generic: true, cards: { ...fallback }, fallback, film };
    const cards = { '4x9': `cards/${key}-4x9.mp4`, '8x9': `cards/${key}-8x9.mp4` };
    const absent = FORMATS.filter((f) => !existsSync(join(cardsDir, `${key}-${f}.mp4`)));
    if (absent.length) {
      // Silently downgrading would put a flag where a face should be.
      throw new BuildError(
        `card-keys.json maps "${p.name}" to "${key}", but cards/${key}-${absent.join(', ')} is missing. ` +
        `Add the file or remove the entry.`,
      );
    }
    return { ...p, generic: false, cards, fallback, film };
  });
}

// Default prober: opens the file with ffprobe. Throws ProbeUnavailable if there is no ffprobe,
// a plain Error if the file cannot be read as video.
export class ProbeUnavailable extends Error {}

export function ffprobeCard(abs) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=codec_name,pix_fmt,width,height:format=duration', '-of', 'json', abs],
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
  return { codec: s.codec_name, pixFmt: s.pix_fmt, width: s.width, height: s.height, duration: Number(j.format && j.format.duration) };
}

// `root` is the directory that holds `cards/` (the party directory), because
// the paths recorded in the show are relative to it, e.g. 'cards/seth-4x9.mp4'.
export function validateCards(show, root, { probe = ffprobeCard } = {}) {
  const problems = [];
  const seen = new Set();
  let unavailable = false;
  // One file, against what that kind of file is supposed to be. Cards and films
  // differ in size and length and in nothing else, so they share the checker
  // rather than each growing their own copy of it.
  const check = (p, rel, want) => {
    if (seen.has(rel)) return;
    seen.add(rel);
    const abs = join(root, rel);
    if (!existsSync(abs)) { problems.push(`${p.name}: missing ${rel}`); return; }
    if (statSync(abs).size === 0) { problems.push(`${p.name}: zero-length ${rel}`); return; }
    if (unavailable) return;
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
      return;
    }
    if (info.codec !== 'h264' || !PIX_FMTS.includes(info.pixFmt)) {
      problems.push(`${p.name}: ${rel} is ${info.codec},${info.pixFmt}; the browser needs h264 with yuv420p or yuvj420p`);
    } else if (info.width !== want.width || info.height !== want.height) {
      problems.push(`${p.name}: ${rel} is ${info.width}x${info.height}, expected ${want.width}x${want.height}`);
    } else if (!Number.isFinite(info.duration) || info.duration < want.min || info.duration > want.max) {
      problems.push(`${p.name}: ${rel} has implausible duration ${info.duration}s ` +
        `(expected ${want.min}-${want.max}s)`);
    }
  };
  for (const p of show.players) {
    for (const fmt of FORMATS) {
      const [width, height] = EXPECTED_SIZE[fmt];
      const paths = [p.cards && p.cards[fmt], p.fallback && p.fallback[fmt]].filter(Boolean);
      for (const rel of paths) check(p, rel, { width, height, min: MIN_SECONDS, max: MAX_SECONDS });
    }
    // A film is optional, so there is nothing to check when there is none. One
    // that IS named must play: it goes on a television for half a minute.
    if (typeof p.film === 'string' && p.film !== '') {
      check(p, p.film, {
        width: FILM_SIZE[0], height: FILM_SIZE[1], min: FILM_MIN_SECONDS, max: FILM_MAX_SECONDS,
      });
    }
  }
  return problems;
}

// --- the films loop's running order ---------------------------------------
//
// Erik's three rules, 18 October: alternate US and International, never two
// Internationals of the same country in a row, never two US players of the same
// state in a row. The loop WRAPS - it plays round again - so every rule is
// checked on the circle, not on the line.
//
// 23 Internationals and 17 US players cannot alternate perfectly: 17 US films
// cut the circle into 17 arcs, so six arcs have to carry two Internationals.
// Those six pairs are the only place two of one side touch, and the spreading
// below is what keeps them different countries.
//
// It is computed here, at build time, for the same reason the cards are: the
// stage should carry out a plan, not work one out. show.json carries the result
// as `filmOrder`, a list of player ids.

const stateOf = (p) => {
  const home = typeof p.hometown === 'string' ? p.hometown.trim() : '';
  return home ? home.split(',').pop().trim() : '\u2014';
};

// Round half to even, so an exactly-halfway position does not drift the whole
// arrangement when a player's state or country changes.
function roundHalf(x) {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

// Even spacing per group, then local repair. Spacing rather than dealing them
// out in turn: a country with six players belongs at six evenly spaced points,
// so India is not every other film for the first half and absent from the rest.
function spread(items, keyOf) {
  const n = items.length;
  if (n < 2) return [...items];
  const groups = new Map();
  for (const p of items) {
    const k = keyOf(p);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(p);
  }
  // Biggest group first: its spacing is the one that must survive rounding.
  const bySize = [...groups.entries()].sort((a, b) => b[1].length - a[1].length
    || String(a[0]).localeCompare(String(b[0])));
  const placed = [];
  for (const [key, members] of bySize) {
    members.forEach((p, i) => placed.push({ at: ((i + 0.5) * n) / members.length, key, p }));
  }
  placed.sort((a, b) => a.at - b.at);          // stable, so ties keep biggest-group-first
  let seq = placed.map((x) => x.p);
  const clashes = (list) => list
    .map((_, i) => i)
    .filter((i) => keyOf(list[i]) === keyOf(list[(i + 1) % list.length]));
  // Swap a clashing neighbour forward to the first position that fixes it and
  // breaks nothing else. Bounded: a pass that cannot improve anything stops.
  for (let guard = 0; guard < n * n; guard++) {
    const bad = clashes(seq);
    if (bad.length === 0) break;
    const i = bad[0];
    const target = (i + 1) % n;
    let moved = false;
    for (let j = 0; j < n; j++) {
      if (j === i || j === target) continue;
      const trial = [...seq];
      [trial[target], trial[j]] = [trial[j], trial[target]];
      if (clashes(trial).length === 0) { seq = trial; moved = true; break; }
    }
    if (!moved) break;                          // no single swap fixes it; leave it to the caller
  }
  return seq;
}

// The ids of every film, in the order the loop should play them. Never throws:
// a show with no films, or one side empty, is a real answer and returns what it
// can rather than stopping a build over the order of a slideshow.
export function filmLoopOrder(players) {
  const list = Array.isArray(players) ? players.filter((p) => p && typeof p.film === 'string' && p.film !== '') : [];
  const intl = spread(list.filter((p) => p.team === 'international'), (p) => p.country || '\u2014');
  const usa = spread(list.filter((p) => p.team !== 'international'), stateOf);
  if (usa.length === 0 || intl.length === 0) return [...intl, ...usa].map((p) => p.id);

  const gaps = usa.length;
  const base = Math.floor(intl.length / gaps);
  const extra = intl.length % gaps;
  const take = new Array(gaps).fill(base);
  for (let i = 0; i < extra; i++) take[roundHalf((i * gaps) / extra) % gaps] += 1;

  const out = [];
  let at = 0;
  for (let g = 0; g < gaps; g++) {
    out.push(usa[g]);
    for (let k = 0; k < take[g] && at < intl.length; k++) out.push(intl[at++]);
  }
  while (at < intl.length) out.push(intl[at++]);   // cannot happen, but never drop a film
  return out.map((p) => p.id);
}

function buildDays(players, runningOrder) {
  const intl = players.filter((p) => p.team === 'international').map((p) => p.id);
  const usa = players.filter((p) => p.team === 'usa').map((p) => p.id);
  if (intl.length !== 26 || usa.length !== 26) {
    throw new BuildError(`expected 26 players a side, got ${intl.length} international and ${usa.length} USA`);
  }
  const intlSet = new Set(intl);
  const entries = runningOrder?.days?.['1'] ?? [];
  if (!Array.isArray(entries)) throw new BuildError('running-order.json: days["1"] must be an array');
  const preset = new Map();
  for (const m of entries) {
    if (m === null || typeof m !== 'object') {
      throw new BuildError(`running-order.json: Day 1 entry ${JSON.stringify(m)} is not a match object`);
    }
    if (!Number.isInteger(m.index) || m.index < 1 || m.index > DAY1_MATCHES) {
      throw new BuildError(`running-order.json: Day 1 index ${JSON.stringify(m.index)} must be an integer from 1 to ${DAY1_MATCHES}`);
    }
    if (preset.has(m.index)) throw new BuildError(`running-order.json: Day 1 match ${m.index} appears twice`);
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
  // A player may play once on a day. Defaults count too: overriding one match can
  // collide with the default pairing of another, and the operator must resolve it.
  const where = new Map();
  for (const m of day1) {
    for (const id of m.intl) {
      if (where.has(id)) {
        throw new BuildError(`Day 1: ${id} is in match ${where.get(id)} and match ${m.index}` +
          (where.get(id) === m.index ? ' (both sides of one match)' : '') +
          ` - a player can play once. Set both matches in running-order.json.`);
      }
      where.set(id, m.index);
    }
  }
  const day2 = [];
  for (let i = 1; i <= DAY2_MATCHES; i++) day2.push({ index: i, intl: [intl[i - 1]], usa: [''] });
  return { 1: day1, 2: day2 };
}


// The slideshow of past years, built separately by build-photos.mjs because it
// reads a folder that is not in this repository and may not exist at all. No
// photographs is the ordinary case for most of the year, so it is an empty list
// and never an error: a show with no photographs simply has nothing to put on a
// screen set to Photos, exactly as a show with no films has nothing for Films.
export function loadPhotos(manifestPath) {
  if (!manifestPath || !existsSync(manifestPath)) return [];
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    return [];              // a half-written manifest must not stop the build
  }
  const rows = parsed && Array.isArray(parsed.photos) ? parsed.photos : [];
  const out = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    if (typeof row.src !== 'string' || row.src === '') continue;
    out.push({
      src: row.src,
      year: typeof row.year === 'string' ? row.year : '',
    });
  }
  return out;
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
  photosPath = join(PARTY, 'photos/manifest.json'),
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
  const show = indexShow({
    built: new Date().toISOString(),
    players,
    days: buildDays(players, runningOrder),
    filmOrder: filmLoopOrder(players),
    photos: loadPhotos(photosPath),
  });
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
    const films = show.players.filter((p) => p.film).length;
    console.log(`\nparty/show.json: ${show.players.length} players ` +
      `(${show.players.length - generic} bespoke, ${generic} flag cards), ` +
      `${films} long-form films, ` +
      `${show.days[1].length} team matches, ${show.days[2].length} singles.`);
    console.log('Reminder: show.json is gitignored. It carries details for people who said no to the website.');
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
