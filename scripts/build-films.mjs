#!/usr/bin/env node
/**
 * Attach the long-form 16x9 films to the public roster.
 *
 * CONSENT IS THE WHOLE POINT OF THIS SCRIPT. A film goes on the website only
 * if the player already appears on the website in detail - that is, carries a
 * photo or a hometown in data/players.json. Players who declined, or who we
 * never heard from, are listed by name alone, and they get no film however
 * many cards were cut for them on the night. Tom Walsh ("for the night only,
 * not for the website") and Daren Wickham ("party only") both HAVE finished
 * films in party/cards/; this rule is what keeps them off.
 *
 * The films themselves are far too big for the repository (~600 MB), so they
 * live in S3 under films/ and are never committed. This writes only the
 * reference and a poster frame.
 *
 *   node scripts/build-films.mjs [--check]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const checkOnly = process.argv.includes('--check');
const CARDS = join(root, 'party', 'cards');
const POSTERS = join(root, 'pics', 'players', 'film');
const POSTER_AT = '24';          // inside the end card, which shows the player
const POSTER_WIDTH = 640;

const keys = JSON.parse(readFileSync(join(root, 'party', 'build', 'card-keys.json'), 'utf8'));
const playersPath = join(root, 'data', 'players.json');
const doc = JSON.parse(readFileSync(playersPath, 'utf8'));

const consented = (p) => Boolean(p.photo || p.hometown);

let attached = 0, withheld = [], noFilm = [], posters = 0;
if (!checkOnly && !existsSync(POSTERS)) mkdirSync(POSTERS, { recursive: true });

for (const side of ['usa', 'international']) {
  for (const player of doc.teams[side]) {
    const key = keys[player.name];
    const source = key ? join(CARDS, `${key}-16x9-web.mp4`) : null;
    const hasFilm = Boolean(source && existsSync(source));

    if (!consented(player)) {
      if (hasFilm) withheld.push(player.name);
      delete player.film;
      delete player.filmPoster;
      continue;
    }
    if (!hasFilm) { noFilm.push(player.name); delete player.film; delete player.filmPoster; continue; }

    player.film = `films/${key}.mp4`;
    player.filmPoster = `pics/players/film/${key}.jpg`;
    attached++;

    const poster = join(POSTERS, `${key}.jpg`);
    if (!checkOnly && !existsSync(poster)) {
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', POSTER_AT, '-i', source,
        '-frames:v', '1', '-vf', `scale=${POSTER_WIDTH}:-2`, '-q:v', '4', poster]);
      posters++;
    }
  }
}

if (!checkOnly) {
  writeFileSync(playersPath, JSON.stringify(doc, null, 2) + '\n');
}

console.log(`films attached:   ${attached}`);
console.log(`withheld (no consent, film exists): ${withheld.length ? withheld.join(', ') : 'none'}`);
console.log(`consented, no film yet:             ${noFilm.length ? noFilm.join(', ') : 'none'}`);
if (!checkOnly) console.log(`poster frames written: ${posters}`);
