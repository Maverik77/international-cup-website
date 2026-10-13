# Pairings Party Interface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local-first Node application in `party/` that drives the big screen at the 22 October 2026 pairings party — staging and revealing player video cards for 13 Day 1 team matches and 26 Day 2 singles, controlled from an iPad, with announced pairings syncing back to the existing AWS tables behind the operator's back.

**Architecture:** One dependency-free Node process on the playback laptop holds the show state in memory, persists it to disk after every change, serves three static surfaces (`/stage`, `/operator`, `/`), and broadcasts state over Server-Sent Events. Commands arrive as HTTP POSTs. A background flusher pushes a complete snapshot of all 39 pairings to the existing `updatePairings` Lambda whenever it can, and is structurally incapable of blocking a reveal. A separate build step produces `party/show.json` plus a 4:9 and an 8:9 video card for every one of the 52 players, generating a flag card for anyone without a bespoke one.

**Tech Stack:** Node.js ≥ 20 with **zero runtime npm dependencies** (`node:http`, `node:fs`, `node:os`, `node:child_process` only). Tests via the built-in `node:test` runner. Vanilla HTML/CSS/JS on the surfaces, no build, no framework. `ffmpeg`/`ffprobe` (Homebrew, 7.1.1) for card generation and validation. One vendored MIT single-file library (`qrcode-generator`), committed, never installed.

**Spec:** `docs/superpowers/specs/2026-10-09-pairings-party-interface-design.md` (commit `09c8b8a`)

## Global Constraints

- **Branch:** all work on `feature/pairings-party`, branched from `staging`. Never commit to `staging` directly.
- **Zero runtime dependencies.** No `npm install` may be required to start the hub. `party/` must never gain a `package.json` with `dependencies`. The only third-party file in the tree is `party/vendor/qrcode.js`, committed as source.
- **Node ≥ 20**, `.mjs` ES modules throughout `party/`. (Erik's machine runs v23.10.0.)
- **PRIVACY — the hardest constraint in this plan.** The repo is public and `contacts/` is gitignored because of it. `party/show.json` is built from `contacts/player-details.json` and therefore contains hometown and school for players who explicitly declined website publication (Tom Walsh: *"For the night only, not for the website."*). `party/show.json`, `party/state*.json` and `party/cards/` **must be gitignored and must never be committed or deployed.** Task 1 adds a test that fails if they are not ignored. Never add `party/` to `.github/workflows/deploy.yml`.
- **`npm run deploy:manual` is dangerous for this work.** It is `aws s3 sync .` with only four excludes and would publish `party/`. It is not used by CI. Do not run it. The CI deploy copies an explicit allow-list of directories and `party/` is not on it — leave it that way.
- **Card formats:** 4:9 is exactly `480x1080`, 8:9 is exactly `960x1080`. Four 4:9 panels or two 8:9 panels fill a 1920x1080 screen exactly. The 16:9 long-form cards in `party/cards/*-16x9*.mp4` are a separate artefact and are not referenced by this application.
- **ffmpeg `drawtext` text must be passed with `textfile=` and `expansion=none`, never `text=`.** Verified empirically on ffmpeg 7.1.1: escaping a comma as `\,` inside a quoted `text='...'` value breaks filtergraph parsing outright, and the `'\''` quote dance swallows the following filter options into the rendered string. `textfile=` + `expansion=none` renders `O'BRIEN, VA 50%` correctly. `party/cards/` already contains cards built by the old `text=` pipeline; that pipeline is not part of this plan and is not being changed.
- **AWS REST API URLs** (no AWS SDK, no credentials — just HTTPS and a password header):
  - production `https://qzq9gvuk9f.execute-api.us-east-1.amazonaws.com/prod`
  - staging `https://9iz68mvngi.execute-api.us-east-1.amazonaws.com/prod`
  - Routes used: `GET /pairings`, `POST /pairings`, `GET /players`, `POST /players`. Header `x-admin-password`.
- **Admin password** is read from `~/.icup-admin-passwords/prod-2026-08-20.txt` or `~/.icup-admin-passwords/staging-2026-08-20.txt` (chosen by `--target`), or from `$ICUP_ADMIN_PASSWORD`. **Never echo it, never log it, never write it into a state file, never include it in an error message.** On an HTTP error log the status code only.
- **Default port 8722.** Override with `--port`.
- **Test command:** `node --test 'party/test/*.test.mjs'` (the quoted glob is required; `node --test party/test/` misbehaves on Node 23).
- **No network and no ffmpeg in unit tests.** Anything that reaches the network takes an injected `fetch`; anything that shells out is either skipped or writes to a temp dir and is marked as such.
- **Commit hygiene:** normal commits, no `--amend`, no `--no-verify`. Every commit message ends with:
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_013XspHF9gopSSxm6j3nkjGb
  ```
- **The laptop is authoritative for the duration of the event.** Nothing in this app reads from AWS automatically; the only pull is the operator pressing refresh.

## Review Focus

Five input classes the spec implies but does not describe, most likely to bite first. Each has a test attached to the task that owns the code.

1. **HTTP `Range` requests.** Safari will not play an `<video>` whose server answers `200` to a ranged request; the TV goes black with no error. Every card is served by our own hub. → Task 9 test.
2. **A name or hometown containing a comma or an apostrophe.** `"Endicott, NY"`, `"Washington, DC"` and a future `O'Brien` all go through `drawtext`. The old escaping breaks the filtergraph; the quote dance silently renders filter options as text. → Task 3 test.
3. **A roster country with no flag mapping.** A late International addition from a twelfth country would otherwise produce a card with no flag, or an ffmpeg crash at minute 40 of a build. The build must refuse, by name, up front. → Task 2 test.
4. **A truncated or corrupt `state.json`.** The laptop sleeping or being closed mid-write is the single likeliest cause of a hub that will not restart — exactly when restarting is the recovery procedure. Writes must be atomic and loads must survive garbage. → Task 6 test.
5. **The same player on both sides of a match, or in two matches on the same day.** Pure operator misclick under pressure. It must be visible on the console before reveal, and must never crash the stage. → Task 5 test (detection) and Task 11 (display).

---

## File Structure

**New files:**

| Path | Purpose |
|---|---|
| `party/hub.mjs` | Entry point: CLI parsing, config, server start, startup banner |
| `party/lib/state.mjs` | Pure reducer over commands; projection to the wire shape; slot validation |
| `party/lib/persist.mjs` | Atomic state write, tolerant state load |
| `party/lib/pairings.mjs` | Show state → the 39 AWS pairing items, in the existing table's exact shape |
| `party/lib/outbox.mjs` | Background snapshot flusher with backoff; cannot throw into its caller |
| `party/lib/static.mjs` | Static file serving with `Range` support and correct content types |
| `party/lib/sse.mjs` | Server-Sent Events fan-out |
| `party/lib/net.mjs` | LAN interface ranking, `.local` host name, operator URLs, terminal QR |
| `party/lib/aws.mjs` | Thin `fetch` wrappers for the four REST routes; password loading |
| `party/build/roster.mjs` | `contacts/player-details.json` → 52 players with stable ids |
| `party/build/flags.json` | Country name → flagcdn code |
| `party/build/card-keys.json` | Player name → existing bespoke card key |
| `party/build/fetch-flags.mjs` | Download the 11 flag PNGs into `party/assets/flags/` |
| `party/build/generic-card.mjs` | ffmpeg flag-card generator, both formats |
| `party/build/build-show.mjs` | Manifest builder: discover cards, generate missing, validate, write `show.json` |
| `party/build/push-roster.mjs` | One-time, confirmed push of the 2026 roster to `icup-players` |
| `party/build/preflight.mjs` | Night-before check: cards, reachability, client isolation, device checklist |
| `party/public/stage.html` `stage.css` `stage.js` | The TV surface |
| `party/public/operator.html` `operator.css` `operator.js` | The iPad/laptop console |
| `party/public/landing.html` | Generated at request time: QR code and both operator URLs |
| `party/vendor/qrcode.js` | Vendored MIT QR encoder (56,694 bytes) |
| `party/assets/flags/*.png` | 11 flag PNGs |
| `party/running-order.json` | Pre-known Day 1 International pairs, by player id |
| `party/README.md` | How to run it on the night |
| `party/test/*.test.mjs` | One test file per lib/build module |

**Modified files:**

| Path | Change |
|---|---|
| `.gitignore` | Add `party/show.json`, `party/state*.json` (`party/cards/` is already ignored) |
| `package.json` | Add the `party:*` scripts |

**Generated, never committed:** `party/show.json`, `party/state.json`, `party/state.rehearsal.json`, `party/cards/*`.

---

### Task 1: Branch, scaffolding, privacy guard, roster module

**Files:**
- Create: `party/build/roster.mjs`, `party/test/roster.test.mjs`, `party/test/privacy.test.mjs`
- Modify: `.gitignore`, `package.json`

**Interfaces:**
- Consumes: `contacts/player-details.json` (gitignored; 52 players under `teams.international` and `teams.usa`).
- Produces:
  - `loadRoster(detailsPath) -> Player[]` where
    `Player = { id, team: 'usa'|'international', name, country, hometown, school }`.
    `id` is `player-usa-<n>` / `player-intl-<n>`, `n` 1-based in file order. `country` defaults to `'USA'` for the USA team. `hometown` and `school` are `''` when absent.
  - `RosterError` — thrown with a human sentence when the details file is missing or malformed.

- [ ] **Step 1: Create the branch**

```bash
cd /Users/erikwagner/coding/international_cup_website
git checkout staging && git pull
git checkout -b feature/pairings-party
mkdir -p party/lib party/build party/public party/test party/vendor party/assets/flags
```

- [ ] **Step 2: Write the privacy test (it must fail before `.gitignore` is touched)**

Create `party/test/privacy.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

// The repo is public. show.json carries hometown and school for players who
// declined website publication; state.json carries whatever is on screen.
// Neither may ever be committable.
const MUST_BE_IGNORED = [
  'party/show.json',
  'party/state.json',
  'party/state.rehearsal.json',
  'party/cards/seth-4x9.mp4',
];

for (const path of MUST_BE_IGNORED) {
  test(`${path} is gitignored`, () => {
    const r = spawnSync('git', ['check-ignore', '-q', path], { cwd: process.cwd() });
    assert.equal(r.status, 0, `${path} is NOT ignored by .gitignore`);
  });
}

test('the deploy workflow does not copy party/', () => {
  const r = spawnSync('grep', ['-n', 'party', '.github/workflows/deploy.yml']);
  assert.equal(r.stdout.toString(), '', 'deploy.yml references party/ — it must not be deployed');
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `node --test 'party/test/*.test.mjs'`
Expected: FAIL — `party/show.json is NOT ignored by .gitignore` (the `party/cards/...` case already passes).

- [ ] **Step 4: Add the ignore rules**

Append to `.gitignore`, directly under the existing `party/cards/` block:

```
# Party show manifest and live state - built from contacts/, must never be published
party/show.json
party/state.json
party/state.rehearsal.json
```

- [ ] **Step 5: Run it to verify it passes**

Run: `node --test 'party/test/*.test.mjs'`
Expected: PASS, 5 tests.

- [ ] **Step 6: Write the roster test**

Create `party/test/roster.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadRoster, RosterError } from '../build/roster.mjs';

function fixture(teams) {
  const dir = mkdtempSync(join(tmpdir(), 'roster-'));
  const path = join(dir, 'player-details.json');
  writeFileSync(path, JSON.stringify({ updated: '2026-10-11', teams }));
  return path;
}

test('assigns stable 1-based ids in file order', () => {
  const path = fixture({
    international: [{ name: 'Ashvini Anjutgi', country: 'India' }, { name: 'Erik Wagner', country: 'Germany' }],
    usa: [{ name: 'John Altman', hometown: 'Washington, DC', school: 'Virginia Tech' }],
  });
  const players = loadRoster(path);
  assert.deepEqual(players.map((p) => p.id), ['player-intl-1', 'player-intl-2', 'player-usa-1']);
});

test('defaults country to USA for the USA team and blanks missing fields', () => {
  const path = fixture({ international: [], usa: [{ name: 'Jay Collins' }] });
  const [p] = loadRoster(path);
  assert.deepEqual(p, {
    id: 'player-usa-1', team: 'usa', name: 'Jay Collins',
    country: 'USA', hometown: '', school: '',
  });
});

test('keeps hometown and school for a player who declined website publication', () => {
  // publish:false means "party cards only" - the card still needs the detail.
  const path = fixture({
    international: [],
    usa: [{ name: 'Tom Walsh', hometown: 'Great Falls, VA', school: 'University of Delaware', publish: false }],
  });
  const [p] = loadRoster(path);
  assert.equal(p.hometown, 'Great Falls, VA');
  assert.equal(p.school, 'University of Delaware');
});

test('never leaks the publish flag into the roster', () => {
  const path = fixture({ international: [], usa: [{ name: 'Tom Walsh', publish: false }] });
  assert.equal('publish' in loadRoster(path)[0], false);
});

test('explains itself when the details file is missing', () => {
  assert.throws(() => loadRoster('/nope/player-details.json'), (e) =>
    e instanceof RosterError && /contacts\/player-details\.json/.test(e.message));
});

test('rejects a player with no name', () => {
  const path = fixture({ international: [{ country: 'India' }], usa: [] });
  assert.throws(() => loadRoster(path), RosterError);
});

test('reads the real roster: 26 and 26', () => {
  const players = loadRoster('contacts/player-details.json');
  assert.equal(players.filter((p) => p.team === 'international').length, 26);
  assert.equal(players.filter((p) => p.team === 'usa').length, 26);
  assert.equal(new Set(players.map((p) => p.id)).size, 52);
});
```

- [ ] **Step 7: Run it to verify it fails**

Run: `node --test 'party/test/*.test.mjs'`
Expected: FAIL — `Cannot find module '../build/roster.mjs'`.

- [ ] **Step 8: Implement the roster module**

Create `party/build/roster.mjs`:

```js
import { readFileSync } from 'node:fs';

export class RosterError extends Error {}

const PREFIX = { international: 'player-intl', usa: 'player-usa' };

export function loadRoster(detailsPath) {
  let raw;
  try {
    raw = readFileSync(detailsPath, 'utf8');
  } catch {
    throw new RosterError(
      `Cannot read ${detailsPath}. The party build needs contacts/player-details.json, ` +
      `which is gitignored - it is not in a fresh clone. Get it from Erik.`,
    );
  }

  let doc;
  try {
    doc = JSON.parse(raw);
  } catch (e) {
    throw new RosterError(`${detailsPath} is not valid JSON: ${e.message}`);
  }
  if (!doc.teams) throw new RosterError(`${detailsPath} has no "teams" key`);

  const players = [];
  for (const team of ['international', 'usa']) {
    const list = doc.teams[team];
    if (!Array.isArray(list)) throw new RosterError(`${detailsPath}: teams.${team} is not an array`);
    list.forEach((p, i) => {
      const name = (p.name || '').trim();
      if (!name) throw new RosterError(`${detailsPath}: teams.${team}[${i}] has no name`);
      players.push({
        id: `${PREFIX[team]}-${i + 1}`,
        team,
        name,
        country: (p.country || (team === 'usa' ? 'USA' : '')).trim(),
        hometown: (p.hometown || '').trim(),
        school: (p.school || '').trim(),
      });
    });
  }
  return players;
}
```

- [ ] **Step 9: Run it to verify it passes**

Run: `node --test 'party/test/*.test.mjs'`
Expected: PASS, 12 tests.

- [ ] **Step 10: Add the npm scripts**

In `package.json`, add to `"scripts"` (keep the existing entries):

```json
    "party:flags": "node party/build/fetch-flags.mjs",
    "party:build": "node party/build/build-show.mjs",
    "party:start": "node party/hub.mjs",
    "party:rehearse": "node party/hub.mjs --rehearsal",
    "party:preflight": "node party/build/preflight.mjs",
    "party:push-roster": "node party/build/push-roster.mjs",
    "party:test": "node --test 'party/test/*.test.mjs'"
```

- [ ] **Step 11: Commit**

```bash
git add .gitignore package.json party/build/roster.mjs party/test/
git commit -m "$(cat <<'EOF'
feat(party): scaffold the party app, guard show data from the public repo

show.json and state.json are built from contacts/ and carry details for
players who declined website publication. A test asserts they are ignored.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013XspHF9gopSSxm6j3nkjGb
EOF
)"
```

---

### Task 2: Flag assets and the country map

**Files:**
- Create: `party/build/flags.json`, `party/build/fetch-flags.mjs`, `party/test/flags.test.mjs`
- Creates at runtime: `party/assets/flags/*.png` (11 files, committed)

**Interfaces:**
- Consumes: `loadRoster` from Task 1.
- Produces:
  - `FLAG_CODES` — the parsed `flags.json`, `{ [countryName]: flagcdnCode }`.
  - `flagPathFor(country, flagsDir) -> string` — absolute-ish path to the PNG. Throws `FlagError` naming the country when it is not in the map.
  - `FlagError`.

The eleven countries on the 2026 roster are India, England, Korea, Australia, Germany, Canada, Pakistan, Scotland, Spain, Tanzania (International) and USA. All eleven codes were confirmed to resolve at `https://flagcdn.com/w2560/<code>.png`.

- [ ] **Step 1: Write the failing test**

Create `party/test/flags.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { FLAG_CODES, flagPathFor, FlagError } from '../build/fetch-flags.mjs';
import { loadRoster } from '../build/roster.mjs';

test('every country on the real roster has a flag code', () => {
  const missing = [...new Set(loadRoster('contacts/player-details.json').map((p) => p.country))]
    .filter((c) => !(c in FLAG_CODES));
  assert.deepEqual(missing, [], `countries with no flag in party/build/flags.json: ${missing.join(', ')}`);
});

test('an unmapped country fails by name, not silently', () => {
  assert.throws(() => flagPathFor('Narnia', 'party/assets/flags'), (e) =>
    e instanceof FlagError && e.message.includes('Narnia') && e.message.includes('flags.json'));
});

test('every mapped flag has been downloaded', () => {
  for (const country of Object.keys(FLAG_CODES)) {
    assert.ok(existsSync(flagPathFor(country, 'party/assets/flags')),
      `missing flag for ${country} - run: npm run party:flags`);
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test 'party/test/*.test.mjs'`
Expected: FAIL — `Cannot find module '../build/fetch-flags.mjs'`.

- [ ] **Step 3: Write the country map**

Create `party/build/flags.json`:

```json
{
  "India": "in",
  "England": "gb-eng",
  "Korea": "kr",
  "Australia": "au",
  "Germany": "de",
  "Canada": "ca",
  "Pakistan": "pk",
  "Scotland": "gb-sct",
  "Spain": "es",
  "Tanzania": "tz",
  "USA": "us"
}
```

- [ ] **Step 4: Implement the fetcher**

Create `party/build/fetch-flags.mjs`:

```js
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
export const FLAG_CODES = JSON.parse(readFileSync(join(HERE, 'flags.json'), 'utf8'));
export const DEFAULT_FLAGS_DIR = resolve(HERE, '..', 'assets', 'flags');

export class FlagError extends Error {}

export function flagPathFor(country, flagsDir = DEFAULT_FLAGS_DIR) {
  const code = FLAG_CODES[country];
  if (!code) {
    throw new FlagError(
      `No flag for "${country}". Add it to party/build/flags.json with its flagcdn ` +
      `code (see https://flagcdn.com), then run: npm run party:flags`,
    );
  }
  return join(flagsDir, `${code}.png`);
}

export async function fetchFlags(flagsDir = DEFAULT_FLAGS_DIR, fetchImpl = fetch) {
  mkdirSync(flagsDir, { recursive: true });
  const results = [];
  for (const [country, code] of Object.entries(FLAG_CODES)) {
    const path = join(flagsDir, `${code}.png`);
    if (existsSync(path) && statSync(path).size > 1000) {
      results.push({ country, code, status: 'already there' });
      continue;
    }
    const url = `https://flagcdn.com/w2560/${code}.png`;
    const res = await fetchImpl(url);
    if (!res.ok) throw new FlagError(`${url} returned HTTP ${res.status}`);
    writeFileSync(path, Buffer.from(await res.arrayBuffer()));
    const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height', '-of', 'csv=p=0', path]);
    if (probe.status !== 0) throw new FlagError(`${path} downloaded but ffprobe cannot read it`);
    results.push({ country, code, status: `downloaded ${probe.stdout.toString().trim()}` });
  }
  return results;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const r of await fetchFlags()) console.log(`  ${r.country.padEnd(10)} ${r.code.padEnd(8)} ${r.status}`);
  console.log(`\n${Object.keys(FLAG_CODES).length} flags in ${DEFAULT_FLAGS_DIR}`);
}
```

- [ ] **Step 5: Download the flags**

Run: `npm run party:flags`
Expected: eleven lines, each ending `downloaded 2560,<height>`.

- [ ] **Step 6: Run the tests**

Run: `node --test 'party/test/*.test.mjs'`
Expected: PASS, 15 tests.

- [ ] **Step 7: Commit**

```bash
git add party/build/flags.json party/build/fetch-flags.mjs party/test/flags.test.mjs party/assets/flags
git commit -m "$(cat <<'EOF'
feat(party): flag assets for all eleven roster countries

A country with no mapping fails the build by name rather than producing a
card with a hole in it.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013XspHF9gopSSxm6j3nkjGb
EOF
)"
```

---

### Task 3: Generic flag card generator

**Files:**
- Create: `party/build/generic-card.mjs`, `party/test/generic-card.test.mjs`

**Interfaces:**
- Consumes: `flagPathFor` from Task 2.
- Produces:
  - `GEOMETRY` — `{ '4x9': {...}, '8x9': {...} }`, the layout constants below.
  - `fitFontSize(text, baseSize, maxChars) -> number`
  - `cardLines(player) -> { name, gold, white }` — the three text lines, already upper-cased. `gold` is the hometown if there is one, otherwise the country; `white` is the country when the hometown took the gold line, otherwise `''`.
  - `buildGenericCard({ player, format, outPath, flagsDir, workDir }) -> Promise<string>` — resolves to `outPath`. `format` is `'4x9'` or `'8x9'`.

Geometry, matching the bespoke cards built by the existing pipeline so the two sit side by side without looking foreign. Verified by render.

| | 4x9 | 8x9 |
|---|---|---|
| frame | 480x1080 | 960x1080 |
| flag width, overlay y | 400, 240 | 700, 120 |
| scrim top (black@0.74 to the bottom) | 640 | 580 |
| name y / size / max chars | 800 / 36 / 17 | 700 / 68 / 21 |
| rule y / x / width | 852 / 170 / 140 | 788 / 370 / 220 |
| gold line y / size | 866 / 27 | 808 / 50 |
| white line y / size | 908 / 20 | 874 / 36 |

Duration 9.0s, 30fps, h264 crf 19, `+faststart`. Fade in 0.5s, fade out from 8.4s.

- [ ] **Step 1: Write the failing test**

Create `party/test/generic-card.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { buildGenericCard, cardLines, fitFontSize, GEOMETRY } from '../build/generic-card.mjs';

const haveFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

test('hometown takes the gold line and the country goes beneath', () => {
  assert.deepEqual(
    cardLines({ name: 'Kevin Kozlowski', hometown: 'Endicott, NY', country: 'USA' }),
    { name: 'KEVIN KOZLOWSKI', gold: 'ENDICOTT, NY', white: 'USA' },
  );
});

test('with no hometown the country takes the gold line', () => {
  assert.deepEqual(
    cardLines({ name: 'Sridhar Muthusamy', hometown: '', country: 'India' }),
    { name: 'SRIDHAR MUTHUSAMY', gold: 'INDIA', white: '' },
  );
});

test('a long name shrinks to fit, a short one does not', () => {
  assert.equal(fitFontSize('SETH HOLLADAY', 36, 17), 36);
  assert.equal(fitFontSize('SRIDHAR MUTHUSAMY', 36, 17), 36);
  assert.equal(fitFontSize('BARTHOLOMEW CUMBERBATCH-JONES', 36, 17), 21);
});

test('geometry fills a 16:9 screen exactly', () => {
  assert.equal(GEOMETRY['4x9'].width * 4, 1920);
  assert.equal(GEOMETRY['8x9'].width * 2, 1920);
  assert.equal(GEOMETRY['4x9'].height, 1080);
  assert.equal(GEOMETRY['8x9'].height, 1080);
});

// REVIEW FOCUS 2: a comma or an apostrophe must survive drawtext intact.
test('renders a name with an apostrophe and a hometown with a comma', { skip: !haveFfmpeg }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'card-'));
  const out = join(dir, 'obrien-4x9.mp4');
  await buildGenericCard({
    player: { name: "Seamus O'Brien", hometown: 'Great Falls, VA', country: 'USA' },
    format: '4x9', outPath: out, workDir: dir,
  });
  assert.ok(statSync(out).size > 50_000);
  const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height', '-of', 'csv=p=0', out]);
  assert.equal(probe.stdout.toString().trim(), '480,1080');
});

test('builds an 8x9 card at the right size', { skip: !haveFfmpeg }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'card-'));
  const out = join(dir, 'alba-8x9.mp4');
  await buildGenericCard({
    player: { name: 'Alba Phillips', hometown: 'Barcelona', country: 'Spain' },
    format: '8x9', outPath: out, workDir: dir,
  });
  const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height', '-of', 'csv=p=0', out]);
  assert.equal(probe.stdout.toString().trim(), '960,1080');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test 'party/test/*.test.mjs'`
Expected: FAIL — `Cannot find module '../build/generic-card.mjs'`.

- [ ] **Step 3: Implement the generator**

Create `party/build/generic-card.mjs`:

```js
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { flagPathFor, DEFAULT_FLAGS_DIR } from './fetch-flags.mjs';

const BOLD = '/System/Library/Fonts/Supplemental/Arial Bold.ttf';
const REG = '/System/Library/Fonts/Supplemental/Arial.ttf';
const GOLD = '0xFEB619';
const DURATION = 9.0;

export const GEOMETRY = {
  '4x9': { width: 480, height: 1080, flagWidth: 400, flagY: 240, scrimTop: 640,
    nameY: 800, nameSize: 36, nameMaxChars: 17, ruleY: 852, ruleX: 170, ruleW: 140,
    goldY: 866, goldSize: 27, whiteY: 908, whiteSize: 20 },
  '8x9': { width: 960, height: 1080, flagWidth: 700, flagY: 120, scrimTop: 580,
    nameY: 700, nameSize: 68, nameMaxChars: 21, ruleY: 788, ruleX: 370, ruleW: 220,
    goldY: 808, goldSize: 50, whiteY: 874, whiteSize: 36 },
};

export function cardLines(player) {
  const name = (player.name || '').toUpperCase();
  const hometown = (player.hometown || '').toUpperCase();
  const country = (player.country || '').toUpperCase();
  return hometown
    ? { name, gold: hometown, white: country }
    : { name, gold: country, white: '' };
}

export function fitFontSize(text, baseSize, maxChars) {
  if (text.length <= maxChars) return baseSize;
  return Math.floor((baseSize * maxChars) / text.length);
}

// drawtext text MUST go through a file with expansion=none. Passing it inline as
// text='...' breaks on a comma (filtergraph parse error) and on an apostrophe
// (the rest of the filter options get rendered as part of the string).
function textFile(workDir, tag, value) {
  const path = join(workDir, `t-${tag}.txt`);
  writeFileSync(path, value, 'utf8');
  return path;
}

function drawtext({ font, file, size, colour, y, fadeAt }) {
  return `drawtext=fontfile='${font}':textfile='${file}':expansion=none:` +
    `fontcolor=${colour}:fontsize=${size}:x=(w-tw)/2:y=${y}:` +
    `alpha='min(max((t-${fadeAt})/0.45\\,0)\\,1)'`;
}

export function buildGenericCard({ player, format, outPath, flagsDir = DEFAULT_FLAGS_DIR, workDir }) {
  const g = GEOMETRY[format];
  if (!g) throw new Error(`unknown card format "${format}"`);
  const dir = workDir || mkdtempSync(join(tmpdir(), 'genericcard-'));
  const flag = flagPathFor(player.country, flagsDir);
  const lines = cardLines(player);
  const nameSize = fitFontSize(lines.name, g.nameSize, g.nameMaxChars);

  const nameFile = textFile(dir, 'name', lines.name);
  const goldFile = textFile(dir, 'gold', lines.gold);

  const steps = [
    `[0:v]split=2[a][b]`,
    `[a]scale=w=${g.width}:h=${g.height}:force_original_aspect_ratio=increase,` +
      `crop=${g.width}:${g.height},boxblur=24:2,eq=brightness=-0.22:saturation=0.55,` +
      `zoompan=z='min(1.0+0.0008*on,1.08)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':` +
      `d=1:s=${g.width}x${g.height}:fps=30[bg]`,
    `[b]scale=${g.flagWidth}:-1,setsar=1[fg]`,
    `[bg][fg]overlay=x=(W-w)/2:y=${g.flagY}:shortest=1,fade=t=in:st=0:d=0.5[ph]`,
    `[ph]drawbox=x=0:y=${g.scrimTop}:w=${g.width}:h=${g.height - g.scrimTop}:color=black@0.74:t=fill[s0]`,
    `[s0]${drawtext({ font: BOLD, file: nameFile, size: nameSize, colour: 'white', y: g.nameY, fadeAt: 0.7 })}[s1]`,
    `[s1]drawbox=x=${g.ruleX}:y=${g.ruleY}:w=${g.ruleW}:h=3:color=${GOLD}@0.9:t=fill:enable='gte(t,1.0)'[s2]`,
    `[s2]${drawtext({ font: BOLD, file: goldFile, size: g.goldSize, colour: GOLD, y: g.goldY, fadeAt: 1.1 })}[s3]`,
  ];
  if (lines.white) {
    const whiteFile = textFile(dir, 'white', lines.white);
    steps.push(`[s3]${drawtext({ font: REG, file: whiteFile, size: g.whiteSize, colour: 'white@0.88', y: g.whiteY, fadeAt: 1.35 })}[s4]`);
  } else {
    steps.push('[s3]null[s4]');
  }
  steps.push(`[s4]fade=t=out:st=${DURATION - 0.6}:d=0.6,format=yuv420p[out]`);

  const args = ['-v', 'error', '-loop', '1', '-i', flag,
    '-filter_complex', steps.join(';'), '-map', '[out]', '-t', String(DURATION),
    '-c:v', 'libx264', '-crf', '19', '-preset', 'medium', '-movflags', '+faststart',
    outPath, '-y'];

  return new Promise((ok, fail) => {
    const p = spawn('ffmpeg', args);
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', fail);
    p.on('close', (code) => code === 0
      ? ok(outPath)
      : fail(new Error(`ffmpeg exited ${code} building ${outPath}\n${err.trim()}`)));
  });
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test 'party/test/*.test.mjs'`
Expected: PASS, 21 tests. The two ffmpeg tests take a few seconds each.

- [ ] **Step 5: Look at one**

```bash
mkdir -p /tmp/cardcheck && node -e "
import('./party/build/generic-card.mjs').then(async (m) => {
  await m.buildGenericCard({ player: { name: \"Seamus O'Brien\", hometown: 'Great Falls, VA', country: 'USA' }, format: '4x9', outPath: '/tmp/cardcheck/a.mp4', workDir: '/tmp/cardcheck' });
  await m.buildGenericCard({ player: { name: 'Alba Phillips', hometown: 'Barcelona', country: 'Spain' }, format: '8x9', outPath: '/tmp/cardcheck/b.mp4', workDir: '/tmp/cardcheck' });
});"
ffmpeg -v error -ss 7 -i /tmp/cardcheck/a.mp4 -frames:v 1 /tmp/cardcheck/a.png -y
ffmpeg -v error -ss 7 -i /tmp/cardcheck/b.mp4 -frames:v 1 /tmp/cardcheck/b.png -y
ffmpeg -v error -i /tmp/cardcheck/a.png -i /tmp/cardcheck/b.png -filter_complex "[0:v]scale=-1:720[x];[1:v]scale=-1:720[y];[x][y]hstack" /tmp/cardcheck/sheet.png -y
open /tmp/cardcheck/sheet.png
```

Expected: two cards. The flag sits whole and sharp over a blurred, darkened copy of itself; the scrim carries the name in white, a gold rule, the hometown in gold and the country in white. The apostrophe in `O'BRIEN` and the comma in `GREAT FALLS, VA` render as themselves — no backslashes, no filter options leaking into the text.

- [ ] **Step 6: Commit**

```bash
git add party/build/generic-card.mjs party/test/generic-card.test.mjs
git commit -m "$(cat <<'EOF'
feat(party): generate a flag card for any player without a photo

drawtext goes through textfile= with expansion=none. Inline text= breaks on a
comma and silently renders filter options when the string has an apostrophe.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013XspHF9gopSSxm6j3nkjGb
EOF
)"
```

---

### Task 4: The manifest build and its validation

**Files:**
- Create: `party/build/card-keys.json`, `party/running-order.json`, `party/build/build-show.mjs`, `party/test/build-show.test.mjs`

**Interfaces:**
- Consumes: `loadRoster` (Task 1), `flagPathFor` (Task 2), `buildGenericCard` (Task 3).
- Produces:
  - `buildShow({ detailsPath, cardsDir, flagsDir, runningOrderPath, onProgress }) -> Promise<Show>` where

```
Show = {
  built:    <iso8601>,
  players:  Player[],                       // Player from Task 1, plus:
                                            //   cards:    { '4x9': 'cards/seth-4x9.mp4',
                                            //               '8x9': 'cards/seth-8x9.mp4' }
                                            //   fallback: { '4x9': 'cards/player-usa-14-4x9.mp4',
                                            //               '8x9': 'cards/player-usa-14-8x9.mp4' }
                                            //   generic: boolean  (cards === fallback when true)
  days: {
    '1': [ { index: 1, intl: [id,id], usa: [id,id] }, ... 13 ],
    '2': [ { index: 1, intl: [id],    usa: [id]    }, ... 26 ]
  }
}
```
  - `indexShow(show) -> show` — adds a non-enumerable `byId` map; called by everything that reads a show.
  - `validateCards(show, cardsDir) -> string[]` — list of human-readable problems; empty means good.
  - `BuildError`.

**Every player gets a flag card, including the twenty with bespoke ones.** Spec §7 says a missing or corrupt video falls back to "that player's generic card", which only means something if one exists. So the build generates a flag card for all 52 and records it as `fallback`; for a player with no photo, `cards` and `fallback` are the same files. That is 104 clips rather than 74, about half an hour of ffmpeg, run once.

Slot counts are fixed at **13 Day 1 team matches and 26 Day 2 singles** (26 players a side). Note the existing `pairings/admin.html` still hardcodes last year's 12 and 24; that file is out of scope and is not being changed.

- [ ] **Step 1: Write the card-key map**

Create `party/build/card-keys.json`. These are the twenty players who already have bespoke cards in `party/cards/`:

```json
{
  "Alba Phillips": "alba",
  "Ashvini Anjutgi": "ashvini",
  "Chrissy Crouse": "chrissy",
  "Erik Wagner": "erik",
  "Frank Ambrose": "frank",
  "Jeff Galkin": "jeff",
  "Jeff Kritsberg": "krits",
  "Jeff Miller": "miller",
  "Jay Vosburgh": "jay",
  "Keith Barnes": "keith",
  "Kevin Kozlowski": "kevin",
  "Maggie Vosburgh": "maggie",
  "Rhys Gully": "rhys",
  "Robbie Neilson": "robbie",
  "Seth Holladay": "seth",
  "Soban Ansari": "soban",
  "Stefan Lambert": "stefan",
  "Tom Walsh": "tom",
  "Vijay Davuluri": "vijay",
  "Yun Sang Bae": "yun"
}
```

- [ ] **Step 2: Write the running order**

Create `party/running-order.json`. Day 1 International pairs are usually known in advance; USA opponents are drawn live. This is the default — consecutive pairs in roster order — and Erik overwrites it when he has the real one.

```json
{
  "note": "Day 1 International pairs, pre-filled on the console as suggestions. USA sides are drawn live. Player ids come from party/build/roster.mjs. Day 2 is one player per side in roster order.",
  "days": {
    "1": [
      { "index": 1,  "intl": ["player-intl-1",  "player-intl-2"] },
      { "index": 2,  "intl": ["player-intl-3",  "player-intl-4"] },
      { "index": 3,  "intl": ["player-intl-5",  "player-intl-6"] },
      { "index": 4,  "intl": ["player-intl-7",  "player-intl-8"] },
      { "index": 5,  "intl": ["player-intl-9",  "player-intl-10"] },
      { "index": 6,  "intl": ["player-intl-11", "player-intl-12"] },
      { "index": 7,  "intl": ["player-intl-13", "player-intl-14"] },
      { "index": 8,  "intl": ["player-intl-15", "player-intl-16"] },
      { "index": 9,  "intl": ["player-intl-17", "player-intl-18"] },
      { "index": 10, "intl": ["player-intl-19", "player-intl-20"] },
      { "index": 11, "intl": ["player-intl-21", "player-intl-22"] },
      { "index": 12, "intl": ["player-intl-23", "player-intl-24"] },
      { "index": 13, "intl": ["player-intl-25", "player-intl-26"] }
    ]
  }
}
```

- [ ] **Step 3: Write the failing test**

Create `party/test/build-show.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validateCards, indexShow, planCards, BuildError } from '../build/build-show.mjs';
import { loadRoster } from '../build/roster.mjs';

const roster = () => loadRoster('contacts/player-details.json');

test('every player gets both formats', () => {
  const plan = planCards(roster(), 'party/cards');
  assert.equal(plan.length, 52);
  for (const p of plan) {
    assert.match(p.cards['4x9'], /^cards\/.+-4x9\.mp4$/);
    assert.match(p.cards['8x9'], /^cards\/.+-8x9\.mp4$/);
  }
});

test('the twenty bespoke cards are claimed, the rest are generic', () => {
  const plan = planCards(roster(), 'party/cards');
  const bespoke = plan.filter((p) => !p.generic);
  assert.equal(bespoke.length, 20);
  assert.equal(plan.find((p) => p.name === 'Seth Holladay').cards['4x9'], 'cards/seth-4x9.mp4');
  const anyGeneric = plan.find((p) => p.generic);
  assert.equal(anyGeneric.cards['4x9'], `cards/${anyGeneric.id}-4x9.mp4`);
});

test('every player has a flag card to fall back to, named by id', () => {
  const plan = planCards(roster(), 'party/cards');
  const seth = plan.find((p) => p.name === 'Seth Holladay');
  assert.equal(seth.fallback['4x9'], `cards/${seth.id}-4x9.mp4`);
  assert.notEqual(seth.fallback['4x9'], seth.cards['4x9']);
  const generic = plan.find((p) => p.generic);
  assert.deepEqual(generic.fallback, generic.cards, 'a generic player falls back to themselves');
});

test('a card key naming nobody is a build error, not a silent miss', () => {
  assert.throws(() => planCards(roster(), 'party/cards', { 'Nobody At All': 'nope' }), (e) =>
    e instanceof BuildError && e.message.includes('Nobody At All'));
});

test('validation catches a missing card and a zero-length one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'show-'));
  mkdirSync(join(dir, 'cards'));
  writeFileSync(join(dir, 'cards', 'a-4x9.mp4'), '');
  const show = indexShow({
    built: 'now', days: { 1: [], 2: [] },
    players: [{ id: 'p1', name: 'A', cards: { '4x9': 'cards/a-4x9.mp4', '8x9': 'cards/a-8x9.mp4' } }],
  });
  const problems = validateCards(show, dir);
  assert.equal(problems.length, 2);
  assert.ok(problems.some((p) => p.includes('zero-length') && p.includes('a-4x9.mp4')));
  assert.ok(problems.some((p) => p.includes('missing') && p.includes('a-8x9.mp4')));
});

test('indexShow gives a byId lookup that does not serialise', () => {
  const show = indexShow({ built: 'now', players: [{ id: 'x', name: 'X' }], days: { 1: [], 2: [] } });
  assert.equal(show.byId.x.name, 'X');
  assert.equal('byId' in JSON.parse(JSON.stringify(show)), false);
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `node --test 'party/test/*.test.mjs'`
Expected: FAIL — `Cannot find module '../build/build-show.mjs'`.

- [ ] **Step 5: Implement the build**

Create `party/build/build-show.mjs`:

```js
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
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

export class BuildError extends Error {}

export function indexShow(show) {
  Object.defineProperty(show, 'byId', {
    value: Object.fromEntries(show.players.map((p) => [p.id, p])),
    enumerable: false, configurable: true,
  });
  return show;
}

// Decide every player's two filenames. A player with a bespoke card keeps its
// nickname-based name; everyone else gets a generic card named by id, so adding
// a real card later is a rename in card-keys.json and a rebuild, nothing more.
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
    const bespoke = Boolean(key)
      && existsSync(join(cardsDir, `${key}-4x9.mp4`))
      && existsSync(join(cardsDir, `${key}-8x9.mp4`));
    const base = bespoke ? key : p.id;
    // The flag card is always built and always named by id, so §7's "fall back
    // to that player's generic card" is a file that actually exists.
    const fallback = { '4x9': `cards/${p.id}-4x9.mp4`, '8x9': `cards/${p.id}-8x9.mp4` };
    return {
      ...p,
      generic: !bespoke,
      cards: bespoke ? { '4x9': `cards/${base}-4x9.mp4`, '8x9': `cards/${base}-8x9.mp4` } : fallback,
      fallback,
    };
  });
}

function checkOne(name, rel, fmt, root) {
  const abs = join(root, rel);
  if (!existsSync(abs)) return `${name}: missing ${rel}`;
  if (statSync(abs).size === 0) return `${name}: zero-length ${rel}`;
  const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height', '-of', 'csv=p=0', abs]);
  if (probe.status !== 0) return `${name}: unreadable ${rel}`;
  const want = fmt === '4x9' ? '480,1080' : '960,1080';
  const got = probe.stdout.toString().trim();
  if (got !== want) return `${name}: ${rel} is ${got}, expected ${want}`;
  return null;
}

export function validateCards(show, root) {
  const problems = [];
  const seen = new Set();
  for (const p of show.players) {
    for (const fmt of ['4x9', '8x9']) {
      const paths = [p.cards[fmt], p.fallback && p.fallback[fmt]].filter(Boolean);
      for (const rel of paths) {
        if (seen.has(rel)) continue;
        seen.add(rel);
        const problem = checkOne(p.name, rel, fmt, root);
        if (problem) problems.push(problem);
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
  const preset = new Map((runningOrder?.days?.['1'] || []).map((m) => [m.index, m.intl]));
  const day1 = [];
  for (let i = 1; i <= DAY1_MATCHES; i++) {
    day1.push({ index: i, intl: preset.get(i) || [intl[(i - 1) * 2], intl[(i - 1) * 2 + 1]], usa: ['', ''] });
  }
  const day2 = [];
  for (let i = 1; i <= DAY2_MATCHES; i++) day2.push({ index: i, intl: [intl[i - 1]], usa: [''] });
  return { 1: day1, 2: day2 };
}

export async function buildShow({
  detailsPath = join(REPO, 'contacts/player-details.json'),
  cardsDir = join(PARTY, 'cards'),
  flagsDir = DEFAULT_FLAGS_DIR,
  runningOrderPath = join(PARTY, 'running-order.json'),
  onProgress = () => {},
} = {}) {
  mkdirSync(cardsDir, { recursive: true });
  const players = planCards(loadRoster(detailsPath), cardsDir);
  const runningOrder = existsSync(runningOrderPath)
    ? JSON.parse(readFileSync(runningOrderPath, 'utf8')) : null;

  // Build the flag card for everyone, bespoke players included: it is what a
  // broken bespoke clip falls back to on the night.
  const todo = [];
  for (const p of players) {
    for (const fmt of ['4x9', '8x9']) {
      const abs = join(PARTY, p.fallback[fmt]);
      if (!existsSync(abs) || statSync(abs).size === 0) todo.push({ player: p, format: fmt, outPath: abs });
    }
  }
  onProgress(`generating ${todo.length} flag cards`);
  for (const [n, job] of todo.entries()) {
    await buildGenericCard({ ...job, flagsDir, workDir: cardsDir });
    onProgress(`  [${n + 1}/${todo.length}] ${job.player.name} ${job.format}`);
  }

  const show = indexShow({ built: new Date().toISOString(), players, days: buildDays(players, runningOrder) });

  const problems = validateCards(show, PARTY);
  if (problems.length) {
    throw new BuildError(`the show is not playable:\n  ${problems.join('\n  ')}`);
  }
  writeFileSync(join(PARTY, 'show.json'), JSON.stringify(show, null, 2));
  return show;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const show = await buildShow({ onProgress: (m) => console.log(m) });
  const generic = show.players.filter((p) => p.generic).length;
  console.log(`\nparty/show.json: ${show.players.length} players ` +
    `(${show.players.length - generic} bespoke, ${generic} flag cards), ` +
    `${show.days[1].length} team matches, ${show.days[2].length} singles.`);
  console.log('Reminder: show.json is gitignored. It carries details for people who said no to the website.');
}
```

- [ ] **Step 6: Run the tests**

Run: `node --test 'party/test/*.test.mjs'`
Expected: PASS, 27 tests.

- [ ] **Step 7: Build the real show**

Run: `npm run party:build`
Expected: `generating 104 flag cards`, then a numbered line per clip (roughly half an hour), then a summary reading `52 players (20 bespoke, 32 flag cards), 13 team matches, 26 singles.` Re-running is cheap: it only builds what is missing. Then confirm it is not committable:

```bash
git status --porcelain party/ | grep -v '^?? party/assets' || echo "nothing stageable from the build - correct"
git check-ignore -q party/show.json && echo "show.json ignored - correct"
```

- [ ] **Step 8: Commit**

```bash
git add party/build/build-show.mjs party/build/card-keys.json party/running-order.json party/test/build-show.test.mjs
git commit -m "$(cat <<'EOF'
feat(party): build show.json and a card for every one of the 52 players

Twenty keep their bespoke card; the other thirty-two get a flag card so no
slot on the screen can ever be empty. The build refuses to finish if any
referenced card is missing, empty, unreadable or the wrong size.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013XspHF9gopSSxm6j3nkjGb
EOF
)"
```

---

### Task 5: The state machine

**Files:**
- Create: `party/lib/state.mjs`, `party/test/state.test.mjs`

**Interfaces:**
- Consumes: a `Show` (Task 4) for slot counts and player validity.
- Produces:
  - `initialState(show) -> State`
  - `reduce(state, command, show) -> State` — pure; returns a new object; throws `CommandError` for an invalid command and leaves the caller's state untouched.
  - `project(state, show) -> Wire`
  - `slotProblems(slot, day, allSlots) -> string[]`
  - `CommandError`

```
State = {
  version: 1,
  day: 1 | 2,
  mode: 'idle' | 'live' | 'slideshow',
  current: { '1': <0-based slot index>, '2': <0-based slot index> },
  slots: { '1': Slot[13], '2': Slot[26] },
  slideshow: { position: 0, dwellSeconds: 12 },
  sync: { dirty: false, lastPushed: null, lastError: null },
  rev: <number, increments on every accepted command>,
  history: State[]   // without their own history; bounded to 50
}
Slot = { index, firstSide: 'intl'|'usa', intl: [id,...], usa: [id,...], shown: 'none'|'first'|'both', done: false }

Wire = {
  day, mode, rev, rehearsal,
  slot:      { index, firstSide, intl, usa, shown, problems: string[] },
  next:      { intl, usa },
  completed: [ { day, index, intl, usa } ],
  slideshow: { position, dwellSeconds },
  sync:      { dirty, lastPushed, lastError }
}
```

Commands: `{name:'setDay', day}`, `{name:'goto', index}`, `{name:'setFirstSide', side}`, `{name:'assign', side, players}`, `{name:'reveal'}`, `{name:'next'}`, `{name:'reopen', day, index}`, `{name:'undo'}`, `{name:'setMode', mode}`, `{name:'slideshowGoto', position}`, `{name:'setSync', sync}`.

`setSync` is how the outbox reports status; it does not push history and does not bump `rev`'s meaning for the stage — but it does increment `rev` so the console repaints.

Default `firstSide` is `'intl'` on both days: the International pair is the one pre-filled from the running order (§5.3).

- [ ] **Step 1: Write the failing test**

Create `party/test/state.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialState, reduce, project, slotProblems, CommandError } from '../lib/state.mjs';
import { indexShow } from '../build/build-show.mjs';

function makeShow() {
  const players = [];
  for (let i = 1; i <= 26; i++) players.push({ id: `player-intl-${i}`, team: 'international', name: `I${i}` });
  for (let i = 1; i <= 26; i++) players.push({ id: `player-usa-${i}`, team: 'usa', name: `U${i}` });
  const day1 = [];
  for (let i = 1; i <= 13; i++) day1.push({ index: i, intl: [`player-intl-${i * 2 - 1}`, `player-intl-${i * 2}`], usa: ['', ''] });
  const day2 = [];
  for (let i = 1; i <= 26; i++) day2.push({ index: i, intl: [`player-intl-${i}`], usa: [''] });
  return indexShow({ built: 'now', players, days: { 1: day1, 2: day2 } });
}
const show = makeShow();
const run = (s, ...cmds) => cmds.reduce((acc, c) => reduce(acc, c, show), s);

test('starts idle on day 1 slot 1 with the running order pre-filled', () => {
  const s = initialState(show);
  assert.equal(s.day, 1);
  assert.equal(s.mode, 'idle');
  assert.deepEqual(s.slots['1'][0].intl, ['player-intl-1', 'player-intl-2']);
  assert.deepEqual(s.slots['1'][0].usa, ['', '']);
  assert.equal(s.slots['1'][0].shown, 'none');
  assert.equal(s.slots['1'][0].firstSide, 'intl');
  assert.equal(s.slots['1'].length, 13);
  assert.equal(s.slots['2'].length, 26);
});

test('reveal walks none -> first -> both and no further', () => {
  let s = run(initialState(show), { name: 'reveal' }, { name: 'reveal' });
  assert.equal(s.slots['1'][0].shown, 'both');
  s = run(s, { name: 'reveal' });
  assert.equal(s.slots['1'][0].shown, 'both');
});

test('next completes the slot and advances', () => {
  const s = run(initialState(show),
    { name: 'assign', side: 'usa', players: ['player-usa-1', 'player-usa-2'] },
    { name: 'reveal' }, { name: 'reveal' }, { name: 'next' });
  assert.equal(s.slots['1'][0].done, true);
  assert.equal(s.current['1'], 1);
  assert.equal(project(s, show).completed.length, 1);
  assert.deepEqual(project(s, show).completed[0].usa, ['player-usa-1', 'player-usa-2']);
});

test('next on the last slot stays put rather than running off the end', () => {
  let s = initialState(show);
  s = { ...s, current: { ...s.current, 1: 12 } };
  s = run(s, { name: 'next' });
  assert.equal(s.current['1'], 12);
  assert.equal(s.slots['1'][12].done, true);
});

test('assign rejects the wrong number of players and an unknown id', () => {
  const s = initialState(show);
  assert.throws(() => reduce(s, { name: 'assign', side: 'usa', players: ['player-usa-1'] }, show), CommandError);
  assert.throws(() => reduce(s, { name: 'assign', side: 'usa', players: ['nope', 'player-usa-2'] }, show), CommandError);
});

test('assign rejects a player from the other team', () => {
  const s = initialState(show);
  assert.throws(() => reduce(s, { name: 'assign', side: 'usa', players: ['player-intl-1', 'player-intl-2'] }, show),
    (e) => e instanceof CommandError && /International/.test(e.message));
});

test('day 2 slots take one player a side', () => {
  const s = run(initialState(show), { name: 'setDay', day: 2 },
    { name: 'assign', side: 'usa', players: ['player-usa-1'] });
  assert.deepEqual(s.slots['2'][0].usa, ['player-usa-1']);
});

test('goto jumps anywhere and keeps what was there', () => {
  let s = run(initialState(show), { name: 'assign', side: 'usa', players: ['player-usa-1', 'player-usa-2'] });
  s = run(s, { name: 'goto', index: 7 }, { name: 'goto', index: 0 });
  assert.deepEqual(s.slots['1'][0].usa, ['player-usa-1', 'player-usa-2']);
  assert.throws(() => reduce(s, { name: 'goto', index: 99 }, show), CommandError);
});

test('reopen un-completes a match and jumps to it', () => {
  let s = run(initialState(show), { name: 'reveal' }, { name: 'reveal' }, { name: 'next' });
  s = run(s, { name: 'reopen', day: 1, index: 0 });
  assert.equal(s.slots['1'][0].done, false);
  assert.equal(s.current['1'], 0);
  assert.equal(project(s, show).completed.length, 0);
});

test('undo reverses the last action, and bottoms out safely', () => {
  let s = run(initialState(show), { name: 'reveal' });
  assert.equal(s.slots['1'][0].shown, 'first');
  s = run(s, { name: 'undo' });
  assert.equal(s.slots['1'][0].shown, 'none');
  s = run(s, { name: 'undo' }, { name: 'undo' });
  assert.equal(s.slots['1'][0].shown, 'none');
});

test('history is bounded', () => {
  let s = initialState(show);
  for (let i = 0; i < 80; i++) s = reduce(s, { name: 'setFirstSide', side: i % 2 ? 'usa' : 'intl' }, show);
  assert.ok(s.history.length <= 50);
  assert.equal('history' in s.history[0], false);
});

test('every accepted command marks the outbox dirty and bumps rev', () => {
  const a = initialState(show);
  const b = reduce(a, { name: 'reveal' }, show);
  assert.equal(b.sync.dirty, true);
  assert.equal(b.rev, a.rev + 1);
});

test('setSync clears dirty without pushing history', () => {
  const a = run(initialState(show), { name: 'reveal' });
  const b = reduce(a, { name: 'setSync', sync: { dirty: false, lastPushed: '2026-10-22T23:00:00Z', lastError: null } }, show);
  assert.equal(b.sync.dirty, false);
  assert.equal(b.history.length, a.history.length);
});

test('a command the reducer does not know is rejected, not ignored', () => {
  assert.throws(() => reduce(initialState(show), { name: 'launchMissiles' }, show), CommandError);
});

test('reduce never mutates the state it was given', () => {
  const a = initialState(show);
  const snapshot = JSON.stringify(a);
  reduce(a, { name: 'reveal' }, show);
  assert.equal(JSON.stringify(a), snapshot);
});

test('project shows the next slot for preloading, and nothing past the end', () => {
  const s = initialState(show);
  assert.deepEqual(project(s, show).next.intl, ['player-intl-3', 'player-intl-4']);
  const last = { ...s, current: { ...s.current, 1: 12 } };
  assert.deepEqual(project(last, show).next, { intl: [], usa: [] });
});

test('completed runs day 1 then day 2', () => {
  let s = run(initialState(show), { name: 'reveal' }, { name: 'reveal' }, { name: 'next' });
  s = run(s, { name: 'setDay', day: 2 }, { name: 'reveal' }, { name: 'reveal' }, { name: 'next' });
  assert.deepEqual(project(s, show).completed.map((c) => c.day), [1, 2]);
});

// REVIEW FOCUS 5: operator misclick under pressure.
test('the same player twice in one match is reported, not rejected', () => {
  const problems = slotProblems(
    { index: 1, intl: ['player-intl-1', 'player-intl-1'], usa: ['player-usa-1', 'player-usa-2'] }, 1, []);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /twice in this match/);
});

test('a player already used in another match on the same day is reported', () => {
  const others = [{ index: 1, intl: ['player-intl-1', 'player-intl-2'], usa: ['', ''], done: true }];
  const problems = slotProblems(
    { index: 2, intl: ['player-intl-1', 'player-intl-3'], usa: ['', ''] }, 1, others);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /match 1/);
});

test('problems ride along on the projected slot', () => {
  const s = run(initialState(show), { name: 'assign', side: 'usa', players: ['player-usa-1', 'player-usa-1'] });
  assert.equal(project(s, show).slot.problems.length, 1);
});

test('a clean slot has no problems', () => {
  assert.deepEqual(slotProblems({ index: 1, intl: ['player-intl-1', 'player-intl-2'], usa: ['player-usa-1', 'player-usa-2'] }, 1, []), []);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test 'party/test/*.test.mjs'`
Expected: FAIL — `Cannot find module '../lib/state.mjs'`.

- [ ] **Step 3: Implement the state machine**

Create `party/lib/state.mjs`:

```js
export class CommandError extends Error {}

const HISTORY_LIMIT = 50;
const SIDES = ['intl', 'usa'];
const TEAM_OF = { intl: 'international', usa: 'usa' };
const TEAM_LABEL = { intl: 'International', usa: 'USA' };

const clone = (x) => JSON.parse(JSON.stringify(x));

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

export function sideSize(day) { return day === 1 ? 2 : 1; }

export function slotProblems(slot, day, otherSlots) {
  const problems = [];
  const here = [...(slot.intl || []), ...(slot.usa || [])].filter(Boolean);
  const seen = new Set();
  for (const id of here) {
    if (seen.has(id)) problems.push(`${id} appears twice in this match`);
    seen.add(id);
  }
  for (const other of otherSlots || []) {
    if (other.index === slot.index) continue;
    for (const id of [...(other.intl || []), ...(other.usa || [])].filter(Boolean)) {
      if (seen.has(id)) problems.push(`${id} is already in match ${other.index}`);
    }
  }
  return problems;
}

function currentSlot(state) {
  return state.slots[String(state.day)][state.current[state.day]];
}

function withSlot(state, mutate) {
  const next = clone(state);
  next.history = state.history;
  mutate(next.slots[String(next.day)][next.current[next.day]], next);
  return next;
}

const HANDLERS = {
  setDay(state, cmd) {
    if (cmd.day !== 1 && cmd.day !== 2) throw new CommandError(`day must be 1 or 2, got ${cmd.day}`);
    return { ...clone(state), history: state.history, day: cmd.day };
  },

  goto(state, cmd) {
    const slots = state.slots[String(state.day)];
    if (!Number.isInteger(cmd.index) || cmd.index < 0 || cmd.index >= slots.length) {
      throw new CommandError(`no slot ${cmd.index} on day ${state.day}`);
    }
    const next = clone(state);
    next.history = state.history;
    next.current[next.day] = cmd.index;
    return next;
  },

  setFirstSide(state, cmd) {
    if (!SIDES.includes(cmd.side)) throw new CommandError(`side must be intl or usa, got ${cmd.side}`);
    return withSlot(state, (slot) => { slot.firstSide = cmd.side; });
  },

  assign(state, cmd, show) {
    if (!SIDES.includes(cmd.side)) throw new CommandError(`side must be intl or usa, got ${cmd.side}`);
    const want = sideSize(state.day);
    if (!Array.isArray(cmd.players) || cmd.players.length !== want) {
      throw new CommandError(`day ${state.day} takes ${want} player(s) a side`);
    }
    for (const id of cmd.players) {
      if (id === '') continue;
      const player = show.byId[id];
      if (!player) throw new CommandError(`no player "${id}" in the show`);
      if (player.team !== TEAM_OF[cmd.side]) {
        throw new CommandError(`${player.name} plays for ${TEAM_LABEL[player.team === 'usa' ? 'usa' : 'intl']}, not ${TEAM_LABEL[cmd.side]}`);
      }
    }
    return withSlot(state, (slot) => { slot[cmd.side] = [...cmd.players]; });
  },

  reveal(state) {
    return withSlot(state, (slot) => {
      slot.shown = slot.shown === 'none' ? 'first' : 'both';
    });
  },

  next(state) {
    const next = clone(state);
    next.history = state.history;
    const day = String(next.day);
    const slot = next.slots[day][next.current[next.day]];
    slot.done = true;
    slot.shown = 'both';
    if (next.current[next.day] < next.slots[day].length - 1) next.current[next.day] += 1;
    next.mode = 'live';
    return next;
  },

  reopen(state, cmd) {
    const day = String(cmd.day ?? state.day);
    const slots = state.slots[day];
    if (!slots || !Number.isInteger(cmd.index) || cmd.index < 0 || cmd.index >= slots.length) {
      throw new CommandError(`no slot ${cmd.index} on day ${day}`);
    }
    const next = clone(state);
    next.history = state.history;
    next.day = Number(day);
    next.current[next.day] = cmd.index;
    next.slots[day][cmd.index].done = false;
    next.mode = 'live';
    return next;
  },

  setMode(state, cmd) {
    if (!['idle', 'live', 'slideshow'].includes(cmd.mode)) throw new CommandError(`unknown mode ${cmd.mode}`);
    const next = clone(state);
    next.history = state.history;
    next.mode = cmd.mode;
    if (cmd.mode === 'slideshow') next.slideshow.position = 0;
    return next;
  },

  slideshowGoto(state, cmd) {
    if (!Number.isInteger(cmd.position) || cmd.position < 0) throw new CommandError(`bad slideshow position ${cmd.position}`);
    const next = clone(state);
    next.history = state.history;
    next.slideshow.position = cmd.position;
    return next;
  },
};

export function reduce(state, command, show) {
  if (!command || typeof command.name !== 'string') throw new CommandError('command needs a name');

  if (command.name === 'undo') {
    if (state.history.length === 0) return state;
    const previous = state.history[state.history.length - 1];
    return { ...clone(previous), history: state.history.slice(0, -1), rev: state.rev + 1 };
  }

  if (command.name === 'setSync') {
    return { ...clone(state), history: state.history, sync: { ...command.sync }, rev: state.rev + 1 };
  }

  const handler = HANDLERS[command.name];
  if (!handler) throw new CommandError(`unknown command "${command.name}"`);

  const next = handler(state, command, show);
  const { history: _drop, ...bare } = clone(state);
  next.history = [...state.history, bare].slice(-HISTORY_LIMIT);
  next.rev = state.rev + 1;
  next.sync = { ...next.sync, dirty: true };
  return next;
}

export function project(state) {
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
      problems: slotProblems(slot, state.day, slots),
    },
    next: peek ? { intl: [...peek.intl], usa: [...peek.usa] } : { intl: [], usa: [] },
    completed,
    slideshow: { ...state.slideshow },
    sync: { ...state.sync },
  };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test 'party/test/*.test.mjs'`
Expected: PASS, 48 tests.

- [ ] **Step 5: Commit**

```bash
git add party/lib/state.mjs party/test/state.test.mjs
git commit -m "$(cat <<'EOF'
feat(party): the show state machine

A pure reducer: every command returns a new state, pushes undo history and
marks the outbox dirty. Duplicate players are reported on the console rather
than rejected, because the operator is the one who knows.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013XspHF9gopSSxm6j3nkjGb
EOF
)"
```

---

### Task 6: Persistence

**Files:**
- Create: `party/lib/persist.mjs`, `party/test/persist.test.mjs`

**Interfaces:**
- Consumes: `initialState` (Task 5).
- Produces:
  - `saveState(path, state) -> void` — atomic: write `<path>.tmp` in the same directory, `fsync`, then `rename`.
  - `loadState(path, show) -> { state, recovered: boolean, reason: string|null }` — never throws for a bad file. A corrupt or truncated file is moved aside to `<path>.corrupt-<timestamp>` and a fresh state is returned with `recovered: true`.

- [ ] **Step 1: Write the failing test**

Create `party/test/persist.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { saveState, loadState } from '../lib/persist.mjs';
import { initialState, reduce } from '../lib/state.mjs';
import { indexShow } from '../build/build-show.mjs';

function makeShow() {
  const players = [{ id: 'player-intl-1', team: 'international', name: 'I1' },
    { id: 'player-usa-1', team: 'usa', name: 'U1' }];
  return indexShow({ built: 'now', players,
    days: { 1: [{ index: 1, intl: ['player-intl-1', ''], usa: ['', ''] }],
      2: [{ index: 1, intl: ['player-intl-1'], usa: [''] }] } });
}
const show = makeShow();
const tmp = () => join(mkdtempSync(join(tmpdir(), 'persist-')), 'state.json');

test('a fresh path yields a fresh state', () => {
  const r = loadState(tmp(), show);
  assert.equal(r.recovered, false);
  assert.equal(r.state.rev, 0);
});

test('round-trips exactly', () => {
  const path = tmp();
  const s = reduce(initialState(show), { name: 'reveal' }, show);
  saveState(path, s);
  assert.deepEqual(loadState(path, show).state, s);
});

test('leaves no .tmp file behind', () => {
  const path = tmp();
  saveState(path, initialState(show));
  assert.deepEqual(readdirSync(join(path, '..')), ['state.json']);
});

// REVIEW FOCUS 4: the laptop sleeping mid-write must not stop the hub restarting.
test('a truncated file is set aside and the hub still starts', () => {
  const path = tmp();
  saveState(path, initialState(show));
  const half = readFileSync(path, 'utf8').slice(0, 120);
  writeFileSync(path, half);
  const r = loadState(path, show);
  assert.equal(r.recovered, true);
  assert.match(r.reason, /JSON/i);
  assert.equal(r.state.rev, 0);
  assert.ok(readdirSync(join(path, '..')).some((f) => f.startsWith('state.json.corrupt-')));
});

test('a file that is valid JSON but not a state is set aside too', () => {
  const path = tmp();
  writeFileSync(path, '{"hello":"world"}');
  const r = loadState(path, show);
  assert.equal(r.recovered, true);
  assert.match(r.reason, /not a party state/);
});

test('a state built against a different show is set aside', () => {
  const path = tmp();
  const s = initialState(show);
  s.slots['1'] = [];
  writeFileSync(path, JSON.stringify(s));
  const r = loadState(path, show);
  assert.equal(r.recovered, true);
  assert.match(r.reason, /13|slot count|does not match/i);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test 'party/test/*.test.mjs'`
Expected: FAIL — `Cannot find module '../lib/persist.mjs'`.

- [ ] **Step 3: Implement persistence**

Create `party/lib/persist.mjs`:

```js
import { openSync, writeSync, fsyncSync, closeSync, renameSync, readFileSync, existsSync, renameSync as mv } from 'node:fs';
import { initialState } from './state.mjs';

export function saveState(path, state) {
  const tmp = `${path}.tmp`;
  const body = JSON.stringify(state);
  const fd = openSync(tmp, 'w');
  try {
    writeSync(fd, body);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
}

function setAside(path, reason) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  try { mv(path, `${path}.corrupt-${stamp}`); } catch { /* best effort */ }
  return reason;
}

export function loadState(path, show) {
  if (!existsSync(path)) return { state: initialState(show), recovered: false, reason: null };

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    return { state: initialState(show), recovered: true, reason: setAside(path, `bad JSON: ${e.message}`) };
  }

  const shaped = parsed && parsed.version === 1 && parsed.slots
    && Array.isArray(parsed.slots['1']) && Array.isArray(parsed.slots['2'])
    && parsed.current && parsed.sync;
  if (!shaped) {
    return { state: initialState(show), recovered: true, reason: setAside(path, 'not a party state file') };
  }

  if (parsed.slots['1'].length !== show.days['1'].length
    || parsed.slots['2'].length !== show.days['2'].length) {
    return {
      state: initialState(show),
      recovered: true,
      reason: setAside(path,
        `slot count does not match the show (${parsed.slots['1'].length}/${parsed.slots['2'].length} ` +
        `vs ${show.days['1'].length}/${show.days['2'].length}) - the show was rebuilt`),
    };
  }

  if (!Array.isArray(parsed.history)) parsed.history = [];
  return { state: parsed, recovered: false, reason: null };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test 'party/test/*.test.mjs'`
Expected: PASS, 54 tests.

- [ ] **Step 5: Commit**

```bash
git add party/lib/persist.mjs party/test/persist.test.mjs
git commit -m "$(cat <<'EOF'
feat(party): atomic state writes, tolerant state loads

Restarting is the recovery procedure for a slept laptop, so a half-written
state file must never be the thing that stops the hub coming back.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013XspHF9gopSSxm6j3nkjGb
EOF
)"
```

---

### Task 7: Mapping the show onto the AWS pairing table

**Files:**
- Create: `party/lib/pairings.mjs`, `party/test/pairings.test.mjs`

**Interfaces:**
- Consumes: `State` (Task 5), `Show` (Task 4).
- Produces: `toPairingItems(state) -> Item[]` — always all 39, in day then match order.

The item shape is dictated by the live table, not chosen by us. Confirmed against `GET /pairings` on the staging API on 11 October 2026:

```json
{"revealStep":0,"intl_team":{"player1_id":"","player2_id":""},"day":1,
 "usa_team":{"player1_id":"","player2_id":""},"revealOrder":"usa-first",
 "match_number":1,"id":"day1-team-1","type":"team"}
```

`revealStep` is read by `pairings/display.html`, which shows a match only at `2`. Our `shown` maps straight onto it — `none`→0, `first`→1, `both`→2 — so a match announced in the pub appears on the website as a fully revealed match, which is the point of syncing at all.

- [ ] **Step 1: Write the failing test**

Create `party/test/pairings.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toPairingItems } from '../lib/pairings.mjs';
import { initialState, reduce } from '../lib/state.mjs';
import { indexShow } from '../build/build-show.mjs';

function makeShow() {
  const players = [];
  for (let i = 1; i <= 26; i++) players.push({ id: `player-intl-${i}`, team: 'international', name: `I${i}` });
  for (let i = 1; i <= 26; i++) players.push({ id: `player-usa-${i}`, team: 'usa', name: `U${i}` });
  const day1 = [];
  for (let i = 1; i <= 13; i++) day1.push({ index: i, intl: [`player-intl-${i * 2 - 1}`, `player-intl-${i * 2}`], usa: ['', ''] });
  const day2 = [];
  for (let i = 1; i <= 26; i++) day2.push({ index: i, intl: [`player-intl-${i}`], usa: [''] });
  return indexShow({ built: 'now', players, days: { 1: day1, 2: day2 } });
}
const show = makeShow();

test('always a full snapshot of 39 matches, day 1 then day 2', () => {
  const items = toPairingItems(initialState(show));
  assert.equal(items.length, 39);
  assert.equal(items[0].id, 'day1-team-1');
  assert.equal(items[12].id, 'day1-team-13');
  assert.equal(items[13].id, 'day2-singles-1');
  assert.equal(items[38].id, 'day2-singles-26');
});

test('a team item matches the live table shape exactly', () => {
  const items = toPairingItems(initialState(show));
  assert.deepEqual(Object.keys(items[0]).sort(),
    ['day', 'id', 'intl_team', 'match_number', 'revealOrder', 'revealStep', 'type', 'usa_team']);
  assert.deepEqual(items[0], {
    id: 'day1-team-1', type: 'team', day: 1, match_number: 1,
    intl_team: { player1_id: 'player-intl-1', player2_id: 'player-intl-2' },
    usa_team: { player1_id: '', player2_id: '' },
    revealOrder: 'intl-first', revealStep: 0,
  });
});

test('a singles item matches the live table shape exactly', () => {
  const items = toPairingItems(initialState(show));
  assert.deepEqual(Object.keys(items[13]).sort(),
    ['day', 'id', 'intl_player_id', 'match_number', 'revealOrder', 'revealStep', 'type', 'usa_player_id']);
  assert.deepEqual(items[13], {
    id: 'day2-singles-1', type: 'singles', day: 2, match_number: 1,
    intl_player_id: 'player-intl-1', usa_player_id: '',
    revealOrder: 'intl-first', revealStep: 0,
  });
});

test('shown maps onto the revealStep the website reads', () => {
  let s = initialState(show);
  assert.equal(toPairingItems(s)[0].revealStep, 0);
  s = reduce(s, { name: 'reveal' }, show);
  assert.equal(toPairingItems(s)[0].revealStep, 1);
  s = reduce(s, { name: 'reveal' }, show);
  assert.equal(toPairingItems(s)[0].revealStep, 2);
});

test('firstSide becomes revealOrder', () => {
  const s = reduce(initialState(show), { name: 'setFirstSide', side: 'usa' }, show);
  assert.equal(toPairingItems(s)[0].revealOrder, 'usa-first');
});

test('unassigned slots go up as empty strings, never undefined or null', () => {
  const json = JSON.stringify(toPairingItems(initialState(show)));
  assert.equal(json.includes('null'), false);
  assert.equal(json.includes('undefined'), false);
});

test('two snapshots of the same state are identical, so retries cannot duplicate', () => {
  const s = reduce(initialState(show), { name: 'reveal' }, show);
  assert.deepEqual(toPairingItems(s), toPairingItems(s));
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test 'party/test/*.test.mjs'`
Expected: FAIL — `Cannot find module '../lib/pairings.mjs'`.

- [ ] **Step 3: Implement the mapping**

Create `party/lib/pairings.mjs`:

```js
const REVEAL_STEP = { none: 0, first: 1, both: 2 };

export function toPairingItems(state) {
  const items = [];

  for (const slot of state.slots['1']) {
    items.push({
      id: `day1-team-${slot.index}`,
      type: 'team',
      day: 1,
      match_number: slot.index,
      intl_team: { player1_id: slot.intl[0] || '', player2_id: slot.intl[1] || '' },
      usa_team: { player1_id: slot.usa[0] || '', player2_id: slot.usa[1] || '' },
      revealOrder: `${slot.firstSide}-first`,
      revealStep: REVEAL_STEP[slot.shown],
    });
  }

  for (const slot of state.slots['2']) {
    items.push({
      id: `day2-singles-${slot.index}`,
      type: 'singles',
      day: 2,
      match_number: slot.index,
      intl_player_id: slot.intl[0] || '',
      usa_player_id: slot.usa[0] || '',
      revealOrder: `${slot.firstSide}-first`,
      revealStep: REVEAL_STEP[slot.shown],
    });
  }

  return items;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test 'party/test/*.test.mjs'`
Expected: PASS, 61 tests.

- [ ] **Step 5: Commit**

```bash
git add party/lib/pairings.mjs party/test/pairings.test.mjs
git commit -m "$(cat <<'EOF'
feat(party): map the show onto the existing pairings table

A complete snapshot of all 39 matches every time, in the shape the live table
already uses. Retries cannot duplicate and out-of-order delivery cannot
corrupt, because every write overwrites by key.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013XspHF9gopSSxm6j3nkjGb
EOF
)"
```

---

### Task 8: The outbox

**Files:**
- Create: `party/lib/aws.mjs`, `party/lib/outbox.mjs`, `party/test/outbox.test.mjs`

**Interfaces:**
- Consumes: `toPairingItems` (Task 7).
- Produces:
  - `party/lib/aws.mjs`:
    - `API_URLS = { prod: '...', staging: '...' }`
    - `loadPassword({ target, env }) -> string` — `$ICUP_ADMIN_PASSWORD` first, else `~/.icup-admin-passwords/<target>-2026-08-20.txt`. Throws `AwsError` naming the file it looked for. **Never returns the value in an error message.**
    - `putPairings({ apiUrl, password, items, fetchImpl }) -> Promise<void>` — throws `AwsError('pairings POST returned HTTP 401')` on a non-2xx. The message carries the status, never the body and never the password.
    - `getPairings({ apiUrl, fetchImpl }) -> Promise<Item[]>`
    - `putPlayers`, `getPlayers` — same shape, used by Task 13.
    - `AwsError`
  - `party/lib/outbox.mjs`:
    - `createOutbox({ getState, push, onStatus, now, schedule, cancel, minDelay, maxDelay, enabled }) -> { markDirty, flushNow, stop, pending }`

The flusher is the only part of the app allowed to touch the network, and nothing waits on it. `markDirty()` returns synchronously. `flushNow()` returns a promise that **always resolves** — a caller that awaits it cannot be made to throw.

- [ ] **Step 1: Write the failing test**

Create `party/test/outbox.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOutbox } from '../lib/outbox.mjs';
import { loadPassword, putPairings, AwsError } from '../lib/aws.mjs';
import { initialState, reduce } from '../lib/state.mjs';
import { indexShow } from '../build/build-show.mjs';

function makeShow() {
  const players = [];
  for (let i = 1; i <= 26; i++) players.push({ id: `player-intl-${i}`, team: 'international', name: `I${i}` });
  for (let i = 1; i <= 26; i++) players.push({ id: `player-usa-${i}`, team: 'usa', name: `U${i}` });
  const day1 = [];
  for (let i = 1; i <= 13; i++) day1.push({ index: i, intl: [`player-intl-${i * 2 - 1}`, `player-intl-${i * 2}`], usa: ['', ''] });
  const day2 = [];
  for (let i = 1; i <= 26; i++) day2.push({ index: i, intl: [`player-intl-${i}`], usa: [''] });
  return indexShow({ built: 'now', players, days: { 1: day1, 2: day2 } });
}
const show = makeShow();

// A controllable clock: schedule() records, run() fires the earliest.
function fakeClock() {
  let seq = 0;
  const jobs = new Map();
  return {
    schedule: (fn, ms) => { const id = ++seq; jobs.set(id, { fn, ms }); return id; },
    cancel: (id) => jobs.delete(id),
    pending: () => [...jobs.values()].map((j) => j.ms),
    async run() {
      const [id, job] = [...jobs.entries()][0] || [];
      if (!id) return false;
      jobs.delete(id);
      await job.fn();
      return true;
    },
  };
}

function harness({ pushImpl, enabled = true } = {}) {
  const clock = fakeClock();
  let state = initialState(show);
  const pushes = [];
  const statuses = [];
  const outbox = createOutbox({
    getState: () => state,
    push: pushImpl || (async (items) => { pushes.push(items); }),
    onStatus: (s) => statuses.push(s),
    now: () => '2026-10-22T23:00:00.000Z',
    schedule: clock.schedule, cancel: clock.cancel,
    minDelay: 1000, maxDelay: 30000, enabled,
  });
  return {
    clock, outbox, pushes, statuses,
    change: (cmd) => { state = reduce(state, cmd, show); outbox.markDirty(); },
    get state() { return state; },
  };
}

test('markDirty schedules a flush and does not block', () => {
  const h = harness();
  h.change({ name: 'reveal' });
  assert.deepEqual(h.clock.pending(), [1000]);
  assert.equal(h.pushes.length, 0);
});

test('a flush pushes a full 39-match snapshot', async () => {
  const h = harness();
  h.change({ name: 'reveal' });
  await h.clock.run();
  assert.equal(h.pushes.length, 1);
  assert.equal(h.pushes[0].length, 39);
  assert.deepEqual(h.statuses.at(-1), { dirty: false, lastPushed: '2026-10-22T23:00:00.000Z', lastError: null });
});

test('many changes before the timer fires collapse into one push', async () => {
  const h = harness();
  h.change({ name: 'reveal' });
  h.change({ name: 'reveal' });
  h.change({ name: 'next' });
  assert.equal(h.clock.pending().length, 1);
  await h.clock.run();
  assert.equal(h.pushes.length, 1);
});

test('a failure backs off and keeps the pending flag up', async () => {
  let attempts = 0;
  const h = harness({ pushImpl: async () => { attempts += 1; throw new AwsError('pairings POST returned HTTP 503'); } });
  h.change({ name: 'reveal' });
  await h.clock.run();
  assert.equal(attempts, 1);
  assert.equal(h.statuses.at(-1).dirty, true);
  assert.equal(h.statuses.at(-1).lastError, 'pairings POST returned HTTP 503');
  assert.deepEqual(h.clock.pending(), [2000]);
  await h.clock.run();
  assert.deepEqual(h.clock.pending(), [4000]);
});

test('backoff is capped', async () => {
  const h = harness({ pushImpl: async () => { throw new Error('nope'); } });
  h.change({ name: 'reveal' });
  for (let i = 0; i < 12; i++) await h.clock.run();
  assert.deepEqual(h.clock.pending(), [30000]);
});

test('a success after failures resets the backoff', async () => {
  let fail = true;
  const h = harness({ pushImpl: async () => { if (fail) throw new Error('nope'); } });
  h.change({ name: 'reveal' });
  await h.clock.run();
  fail = false;
  await h.clock.run();
  assert.equal(h.statuses.at(-1).lastError, null);
  h.change({ name: 'reveal' });
  assert.deepEqual(h.clock.pending(), [1000]);
});

test('a change during a flush schedules another one', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const h = harness({ pushImpl: async () => { await gate; } });
  h.change({ name: 'reveal' });
  const running = h.clock.run();
  h.change({ name: 'reveal' });
  release();
  await running;
  assert.equal(h.statuses.at(-1).dirty, true);
  assert.deepEqual(h.clock.pending(), [1000]);
});

test('flushNow never rejects, however badly push misbehaves', async () => {
  const h = harness({ pushImpl: async () => { throw new Error('kaboom'); } });
  await assert.doesNotReject(() => h.outbox.flushNow());
  const h2 = harness({ pushImpl: () => { throw new Error('synchronous kaboom'); } });
  await assert.doesNotReject(() => h2.outbox.flushNow());
});

test('disabled, it never touches the network (rehearsal)', async () => {
  const h = harness({ enabled: false });
  h.change({ name: 'reveal' });
  await h.outbox.flushNow();
  assert.equal(h.pushes.length, 0);
  assert.deepEqual(h.clock.pending(), []);
});

test('stop cancels the pending flush', () => {
  const h = harness();
  h.change({ name: 'reveal' });
  h.outbox.stop();
  assert.deepEqual(h.clock.pending(), []);
});

test('loadPassword prefers the environment and never echoes the value', () => {
  assert.equal(loadPassword({ target: 'staging', env: { ICUP_ADMIN_PASSWORD: 's3cret' } }), 's3cret');
  try {
    loadPassword({ target: 'staging', env: {}, home: '/nowhere' });
    assert.fail('should have thrown');
  } catch (e) {
    assert.ok(e instanceof AwsError);
    assert.match(e.message, /staging-2026-08-20\.txt/);
  }
});

test('putPairings reports the status code and nothing else', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => { seen.push({ url, init }); return { ok: false, status: 401 }; };
  await assert.rejects(
    () => putPairings({ apiUrl: 'https://api.example/prod', password: 's3cret', items: [], fetchImpl }),
    (e) => e instanceof AwsError && e.message === 'pairings POST returned HTTP 401' && !e.message.includes('s3cret'),
  );
  assert.equal(seen[0].url, 'https://api.example/prod/pairings');
  assert.equal(seen[0].init.headers['x-admin-password'], 's3cret');
  assert.deepEqual(JSON.parse(seen[0].init.body), { pairings: [] });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test 'party/test/*.test.mjs'`
Expected: FAIL — `Cannot find module '../lib/outbox.mjs'`.

- [ ] **Step 3: Implement the AWS wrappers**

Create `party/lib/aws.mjs`:

```js
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export class AwsError extends Error {}

export const API_URLS = {
  prod: 'https://qzq9gvuk9f.execute-api.us-east-1.amazonaws.com/prod',
  staging: 'https://9iz68mvngi.execute-api.us-east-1.amazonaws.com/prod',
};

const PASSWORD_FILE = { prod: 'prod-2026-08-20.txt', staging: 'staging-2026-08-20.txt' };

// Never put the password itself into an error, a log line or a state file.
export function loadPassword({ target = 'prod', env = process.env, home = homedir() } = {}) {
  if (env.ICUP_ADMIN_PASSWORD) return env.ICUP_ADMIN_PASSWORD;
  const file = PASSWORD_FILE[target];
  if (!file) throw new AwsError(`unknown target "${target}" - use prod or staging`);
  const path = join(home, '.icup-admin-passwords', file);
  try {
    return readFileSync(path, 'utf8').trim();
  } catch {
    throw new AwsError(`cannot read ${path} - set ICUP_ADMIN_PASSWORD instead`);
  }
}

async function post(apiUrl, route, password, body, fetchImpl) {
  const res = await fetchImpl(`${apiUrl}/${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-password': password },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new AwsError(`${route} POST returned HTTP ${res.status}`);
}

async function get(apiUrl, route, fetchImpl) {
  const res = await fetchImpl(`${apiUrl}/${route}`);
  if (!res.ok) throw new AwsError(`${route} GET returned HTTP ${res.status}`);
  return res.json();
}

export const putPairings = ({ apiUrl, password, items, fetchImpl = fetch }) =>
  post(apiUrl, 'pairings', password, { pairings: items }, fetchImpl);

export const getPairings = async ({ apiUrl, fetchImpl = fetch }) =>
  (await get(apiUrl, 'pairings', fetchImpl)).pairings || [];

export const putPlayers = ({ apiUrl, password, players, fetchImpl = fetch }) =>
  post(apiUrl, 'players', password, { players }, fetchImpl);

export const getPlayers = async ({ apiUrl, fetchImpl = fetch }) =>
  (await get(apiUrl, 'players', fetchImpl)).players || [];
```

- [ ] **Step 4: Implement the outbox**

Create `party/lib/outbox.mjs`:

```js
import { toPairingItems } from './pairings.mjs';

export function createOutbox({
  getState,
  push,
  onStatus = () => {},
  now = () => new Date().toISOString(),
  schedule = setTimeout,
  cancel = clearTimeout,
  minDelay = 1000,
  maxDelay = 30000,
  enabled = true,
}) {
  let timer = null;
  let inFlight = false;
  let failures = 0;
  let lastPushed = null;

  const backoff = () => Math.min(maxDelay, minDelay * 2 ** failures);

  function arm(ms) {
    if (!enabled || timer !== null || inFlight) return;
    timer = schedule(() => { timer = null; return flush(); }, ms);
  }

  async function flush() {
    if (!enabled || inFlight) return;
    inFlight = true;
    const revAtStart = getState().rev;
    try {
      await push(toPairingItems(getState()));
      failures = 0;
      lastPushed = now();
      const stillDirty = getState().rev !== revAtStart;
      inFlight = false;
      onStatus({ dirty: stillDirty, lastPushed, lastError: null });
      if (stillDirty) arm(minDelay);
    } catch (e) {
      failures += 1;
      inFlight = false;
      // The message is ours (lib/aws.mjs) and carries a status code at most.
      onStatus({ dirty: true, lastPushed, lastError: String(e && e.message ? e.message : e) });
      arm(backoff());
    }
  }

  return {
    markDirty() { arm(failures === 0 ? minDelay : backoff()); },
    // Always resolves. Nothing in the reveal path may be made to throw by the network.
    async flushNow() { try { await flush(); } catch { /* unreachable, belt and braces */ } },
    stop() { if (timer !== null) { cancel(timer); timer = null; } },
    pending() { return timer !== null || inFlight; },
  };
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `node --test 'party/test/*.test.mjs'`
Expected: PASS, 73 tests.

- [ ] **Step 6: Commit**

```bash
git add party/lib/aws.mjs party/lib/outbox.mjs party/test/outbox.test.mjs
git commit -m "$(cat <<'EOF'
feat(party): background outbox that cannot stall a reveal

markDirty returns synchronously, flushNow always resolves, and the flusher
never probes the network before acting. A failure costs a backoff and a count
on the console, nothing on the screen.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013XspHF9gopSSxm6j3nkjGb
EOF
)"
```

---

### Task 9: The hub — static serving, SSE, commands, addressing

**Files:**
- Create: `party/lib/net.mjs`, `party/lib/static.mjs`, `party/lib/sse.mjs`, `party/hub.mjs`, `party/vendor/qrcode.js`
- Create: `party/test/net.test.mjs`, `party/test/static.test.mjs`, `party/test/hub.test.mjs`
- Create (placeholders filled in by Tasks 10 and 11): `party/public/stage.html`, `party/public/operator.html`

**Interfaces:**
- Consumes: `loadState`/`saveState` (Task 6), `initialState`/`reduce`/`project`/`CommandError` (Task 5), `createOutbox` (Task 8), `putPairings`/`getPairings`/`loadPassword`/`API_URLS` (Task 8), `indexShow` (Task 4).
- Produces:
  - `party/lib/net.mjs`: `pickLanAddress(interfaces) -> { iface, address } | null`, `localHostName(runner) -> string|null`, `operatorUrls({ address, hostName, port }) -> { ip, mdns }`, `qrLines(text) -> string[]`, `qrSvg(text, cellSize) -> string`
  - `party/lib/static.mjs`: `contentTypeFor(path) -> string`, `safeJoin(root, urlPath) -> string|null`, `serveFile(req, res, absPath) -> void`
  - `party/lib/sse.mjs`: `createSseHub() -> { attach(req, res), broadcast(event, data), count(), closeAll() }`
  - `party/hub.mjs`: `createHub({ showPath, statePath, cardsDir, publicDir, port, target, enableSync, fetchImpl }) -> Promise<{ server, url, addresses, stop() }>`

**Interface ranking rule.** On Erik's laptop `os.networkInterfaces()` reports both `en0` (the wifi, `10.0.0.241`) and `bridge100` (a VM bridge, `192.168.64.1`). Picking the wrong one puts an unreachable address in the QR code. Prefer `en` interfaces by ascending number, then anything else that is IPv4, not internal, and not one of the known virtual prefixes.

**`.local` name.** `os.hostname()` returns `MacBookPro` on this machine, which does **not** resolve over mDNS. The advertised name comes from `scutil --get LocalHostName` (`Eriks-MacBook-Pro`), so the Bonjour URL is `http://Eriks-MacBook-Pro.local:8722/operator`. macOS advertises this itself; there is nothing to register and no library to install.

- [ ] **Step 1: Vendor the QR encoder**

```bash
curl -sS -o party/vendor/qrcode.js https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js
wc -c party/vendor/qrcode.js   # expect 56694
head -8 party/vendor/qrcode.js # expect the MIT header, "QR Code Generator for JavaScript", Kazuhiko Arase
```

If the byte count differs, stop and check what was downloaded before committing it.

- [ ] **Step 2: Write the networking test**

Create `party/test/net.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickLanAddress, localHostName, operatorUrls, qrLines, qrSvg } from '../lib/net.mjs';

const REAL = {
  lo0: [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
  en0: [{ family: 'IPv4', address: '10.0.0.241', internal: false }],
  bridge100: [{ family: 'IPv4', address: '192.168.64.1', internal: false }],
  awdl0: [{ family: 'IPv6', address: 'fe80::1', internal: false }],
};

test('picks the wifi, not the VM bridge', () => {
  assert.deepEqual(pickLanAddress(REAL), { iface: 'en0', address: '10.0.0.241' });
});

test('prefers the lowest-numbered en interface', () => {
  assert.equal(pickLanAddress({
    en5: [{ family: 'IPv4', address: '10.0.0.9', internal: false }],
    en0: [{ family: 'IPv4', address: '10.0.0.1', internal: false }],
  }).address, '10.0.0.1');
});

test('falls back to any real IPv4 when there is no en', () => {
  assert.equal(pickLanAddress({ wlan0: [{ family: 'IPv4', address: '172.20.0.4', internal: false }] }).address, '172.20.0.4');
});

test('returns null when there is nothing routable', () => {
  assert.equal(pickLanAddress({ lo0: [{ family: 'IPv4', address: '127.0.0.1', internal: true }] }), null);
});

test('uses LocalHostName, not os.hostname', () => {
  const runner = () => ({ status: 0, stdout: 'Eriks-MacBook-Pro\n' });
  assert.equal(localHostName(runner), 'Eriks-MacBook-Pro.local');
});

test('no .local name when scutil is unavailable', () => {
  assert.equal(localHostName(() => ({ status: 1, stdout: '' })), null);
});

test('builds both URLs', () => {
  assert.deepEqual(operatorUrls({ address: '10.0.0.241', hostName: 'Eriks-MacBook-Pro.local', port: 8722 }), {
    ip: 'http://10.0.0.241:8722/operator',
    mdns: 'http://Eriks-MacBook-Pro.local:8722/operator',
  });
  assert.equal(operatorUrls({ address: '10.0.0.241', hostName: null, port: 8722 }).mdns, null);
});

test('renders a scannable terminal QR with a quiet zone', () => {
  const lines = qrLines('http://10.0.0.241:8722/operator');
  // 29 modules for this payload at error level M, plus 2 modules of quiet zone each side.
  assert.equal(lines.length, 33);
  assert.ok(lines.every((l) => l.includes('\u001b[')), 'rows should be ANSI coloured');
});

test('renders an SVG for the landing page', () => {
  const svg = qrSvg('http://10.0.0.241:8722/operator', 6);
  assert.match(svg, /^<svg /);
  assert.match(svg, /<\/svg>/);
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `node --test 'party/test/*.test.mjs'`
Expected: FAIL — `Cannot find module '../lib/net.mjs'`.

- [ ] **Step 4: Implement networking**

Create `party/lib/net.mjs`:

```js
import { networkInterfaces } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const qrcode = require('../vendor/qrcode.js');

const VIRTUAL = /^(bridge|utun|awdl|llw|tun|tap|vmnet|vnic|anpi|ap\d)/;

export function pickLanAddress(interfaces = networkInterfaces()) {
  const candidates = [];
  for (const [iface, addrs] of Object.entries(interfaces || {})) {
    if (VIRTUAL.test(iface)) continue;
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      const m = /^en(\d+)$/.exec(iface);
      candidates.push({ iface, address: a.address, rank: m ? Number(m[1]) : 1000 });
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.rank - b.rank || a.iface.localeCompare(b.iface));
  return { iface: candidates[0].iface, address: candidates[0].address };
}

// os.hostname() is "MacBookPro" here and does not resolve over mDNS.
// The Bonjour name macOS actually advertises is scutil's LocalHostName.
export function localHostName(runner = spawnSync) {
  if (process.platform !== 'darwin' && runner === spawnSync) return null;
  const r = runner('scutil', ['--get', 'LocalHostName'], { encoding: 'utf8' });
  if (!r || r.status !== 0) return null;
  const name = String(r.stdout || '').trim();
  return name ? `${name}.local` : null;
}

export function operatorUrls({ address, hostName, port }) {
  return {
    ip: address ? `http://${address}:${port}/operator` : null,
    mdns: hostName ? `http://${hostName}:${port}/operator` : null,
  };
}

function makeCode(text) {
  const code = qrcode(0, 'M');
  code.addData(text);
  code.make();
  return code;
}

const WHITE = '\u001b[47m  \u001b[0m';
const BLACK = '\u001b[40m  \u001b[0m';
const QUIET = 2;

// Dark modules must read dark to a camera, so paint explicit backgrounds
// rather than trusting whatever colour the terminal happens to be.
export function qrLines(text) {
  const code = makeCode(text);
  const n = code.getModuleCount();
  const lines = [];
  for (let r = -QUIET; r < n + QUIET; r++) {
    let line = '';
    for (let c = -QUIET; c < n + QUIET; c++) {
      const dark = r >= 0 && r < n && c >= 0 && c < n && code.isDark(r, c);
      line += dark ? BLACK : WHITE;
    }
    lines.push(line);
  }
  return lines;
}

export function qrSvg(text, cellSize = 6) {
  return makeCode(text).createSvgTag(cellSize, QUIET * cellSize);
}
```

- [ ] **Step 5: Run the net tests**

Run: `node --test 'party/test/*.test.mjs'`
Expected: PASS, 82 tests.

- [ ] **Step 6: Write the static-serving test**

Create `party/test/static.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { contentTypeFor, safeJoin, serveFile } from '../lib/static.mjs';

const root = mkdtempSync(join(tmpdir(), 'static-'));
writeFileSync(join(root, 'clip.mp4'), Buffer.from('0123456789'));
writeFileSync(join(root, 'page.html'), '<p>hi</p>');

async function withServer(fn) {
  const server = createServer((req, res) => {
    const abs = safeJoin(root, req.url);
    if (!abs) { res.writeHead(403).end(); return; }
    serveFile(req, res, abs);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await fn(base); } finally { server.close(); }
}

test('content types', () => {
  assert.equal(contentTypeFor('a.mp4'), 'video/mp4');
  assert.equal(contentTypeFor('a.html'), 'text/html; charset=utf-8');
  assert.equal(contentTypeFor('a.json'), 'application/json; charset=utf-8');
  assert.equal(contentTypeFor('a.js'), 'text/javascript; charset=utf-8');
  assert.equal(contentTypeFor('a.css'), 'text/css; charset=utf-8');
  assert.equal(contentTypeFor('a.png'), 'image/png');
  assert.equal(contentTypeFor('a.wat'), 'application/octet-stream');
});

test('path traversal is refused', () => {
  assert.equal(safeJoin(root, '/../../etc/passwd'), null);
  assert.equal(safeJoin(root, '/%2e%2e/%2e%2e/etc/passwd'), null);
  assert.equal(safeJoin(root, '/clip.mp4'), join(root, 'clip.mp4'));
  assert.equal(safeJoin(root, '/clip.mp4?v=2'), join(root, 'clip.mp4'));
});

// REVIEW FOCUS 1: Safari will not play a video whose server answers 200 to a
// ranged request. The TV just stays black.
test('a ranged request gets a 206 with the right slice and headers', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/clip.mp4`, { headers: { Range: 'bytes=2-5' } });
    assert.equal(res.status, 206);
    assert.equal(res.headers.get('content-range'), 'bytes 2-5/10');
    assert.equal(res.headers.get('content-length'), '4');
    assert.equal(res.headers.get('accept-ranges'), 'bytes');
    assert.equal(await res.text(), '2345');
  });
});

test('an open-ended range runs to the end of the file', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/clip.mp4`, { headers: { Range: 'bytes=7-' } });
    assert.equal(res.status, 206);
    assert.equal(await res.text(), '789');
  });
});

test('a suffix range returns the last n bytes', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/clip.mp4`, { headers: { Range: 'bytes=-3' } });
    assert.equal(res.status, 206);
    assert.equal(await res.text(), '789');
  });
});

test('an unranged request still advertises range support', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/clip.mp4`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('accept-ranges'), 'bytes');
    assert.equal(res.headers.get('content-type'), 'video/mp4');
  });
});

test('a range past the end is a 416, not a crash', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/clip.mp4`, { headers: { Range: 'bytes=50-60' } });
    assert.equal(res.status, 416);
    assert.equal(res.headers.get('content-range'), 'bytes */10');
  });
});

test('a missing file is a 404', async () => {
  await withServer(async (base) => {
    assert.equal((await fetch(`${base}/nope.mp4`)).status, 404);
  });
});

test('html is served no-cache so a reload always gets the new surface', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/page.html`);
    assert.match(res.headers.get('cache-control'), /no-store|no-cache/);
  });
});
```

- [ ] **Step 7: Run it to verify it fails**

Run: `node --test 'party/test/*.test.mjs'`
Expected: FAIL — `Cannot find module '../lib/static.mjs'`.

- [ ] **Step 8: Implement static serving**

Create `party/lib/static.mjs`:

```js
import { createReadStream, statSync, existsSync } from 'node:fs';
import { join, normalize, extname, sep } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

export function contentTypeFor(path) {
  return TYPES[extname(path).toLowerCase()] || 'application/octet-stream';
}

export function safeJoin(root, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(String(urlPath).split('?')[0]);
  } catch {
    return null;
  }
  const abs = normalize(join(root, decoded));
  if (abs !== root && !abs.startsWith(root + sep)) return null;
  return abs;
}

function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header || '').trim());
  if (!m) return null;
  const [, rawStart, rawEnd] = m;
  if (rawStart === '' && rawEnd === '') return null;
  let start;
  let end;
  if (rawStart === '') {
    const n = Number(rawEnd);
    if (n <= 0) return 'unsatisfiable';
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === '' ? size - 1 : Number(rawEnd);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return 'unsatisfiable';
  return { start, end: Math.min(end, size - 1) };
}

export function serveFile(req, res, absPath) {
  if (!existsSync(absPath) || !statSync(absPath).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
    return;
  }
  const { size } = statSync(absPath);
  const type = contentTypeFor(absPath);
  const cache = type.startsWith('video/') || type.startsWith('image/')
    ? 'public, max-age=86400'
    : 'no-store';

  const range = parseRange(req.headers.range, size);

  if (range === 'unsatisfiable') {
    res.writeHead(416, { 'Content-Range': `bytes */${size}`, 'Accept-Ranges': 'bytes' }).end();
    return;
  }

  if (range) {
    const length = range.end - range.start + 1;
    res.writeHead(206, {
      'Content-Type': type,
      'Content-Length': length,
      'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
      'Accept-Ranges': 'bytes',
      'Cache-Control': cache,
    });
    createReadStream(absPath, { start: range.start, end: range.end }).pipe(res);
    return;
  }

  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': size,
    'Accept-Ranges': 'bytes',
    'Cache-Control': cache,
  });
  createReadStream(absPath).pipe(res);
}
```

- [ ] **Step 9: Run the static tests**

Run: `node --test 'party/test/*.test.mjs'`
Expected: PASS, 91 tests.

- [ ] **Step 10: Implement the SSE hub**

Create `party/lib/sse.mjs`:

```js
export function createSseHub({ pingMs = 15000 } = {}) {
  const clients = new Set();
  let nextId = 0;

  const ping = setInterval(() => {
    for (const res of clients) { try { res.write(':ping\n\n'); } catch { clients.delete(res); } }
  }, pingMs);
  ping.unref?.();

  return {
    attach(req, res) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.flushHeaders?.();
      res.write('retry: 2000\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
    },
    broadcast(event, data) {
      const frame = `id: ${++nextId}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
      for (const res of clients) { try { res.write(frame); } catch { clients.delete(res); } }
    },
    count() { return clients.size; },
    closeAll() {
      clearInterval(ping);
      for (const res of clients) { try { res.end(); } catch { /* going away anyway */ } }
      clients.clear();
    },
  };
}
```

- [ ] **Step 11: Write the hub integration test**

Create `party/test/hub.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHub } from '../hub.mjs';

function fixtureShow(dir) {
  const players = [];
  for (let i = 1; i <= 26; i++) players.push({ id: `player-intl-${i}`, team: 'international', name: `I${i}`, country: 'India', hometown: '', school: '', generic: true, cards: { '4x9': `cards/i${i}-4x9.mp4`, '8x9': `cards/i${i}-8x9.mp4` }, fallback: { '4x9': `cards/i${i}-4x9.mp4`, '8x9': `cards/i${i}-8x9.mp4` } });
  for (let i = 1; i <= 26; i++) players.push({ id: `player-usa-${i}`, team: 'usa', name: `U${i}`, country: 'USA', hometown: '', school: '', generic: true, cards: { '4x9': `cards/u${i}-4x9.mp4`, '8x9': `cards/u${i}-8x9.mp4` }, fallback: { '4x9': `cards/u${i}-4x9.mp4`, '8x9': `cards/u${i}-8x9.mp4` } });
  const day1 = [];
  for (let i = 1; i <= 13; i++) day1.push({ index: i, intl: [`player-intl-${i * 2 - 1}`, `player-intl-${i * 2}`], usa: ['', ''] });
  const day2 = [];
  for (let i = 1; i <= 26; i++) day2.push({ index: i, intl: [`player-intl-${i}`], usa: [''] });
  const showPath = join(dir, 'show.json');
  writeFileSync(showPath, JSON.stringify({ built: 'now', players, days: { 1: day1, 2: day2 } }));
  return showPath;
}

async function startHub(opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'hub-'));
  const cardsDir = join(dir, 'cards');
  mkdirSync(cardsDir);
  writeFileSync(join(cardsDir, 'i1-4x9.mp4'), Buffer.from('videobytes'));
  const publicDir = join(dir, 'public');
  mkdirSync(publicDir);
  writeFileSync(join(publicDir, 'stage.html'), '<h1>stage</h1>');
  writeFileSync(join(publicDir, 'operator.html'), '<h1>operator</h1>');
  const hub = await createHub({
    showPath: fixtureShow(dir),
    statePath: join(dir, 'state.json'),
    cardsDir, publicDir, port: 0, enableSync: false, quiet: true,
    ...opts,
  });
  return { hub, dir, base: `http://127.0.0.1:${hub.server.address().port}` };
}

const post = (base, body) => fetch(`${base}/api/command`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

test('serves the show and the initial state', async () => {
  const { hub, base } = await startHub();
  try {
    const show = await (await fetch(`${base}/api/show`)).json();
    assert.equal(show.players.length, 52);
    const state = await (await fetch(`${base}/api/state`)).json();
    assert.equal(state.day, 1);
    assert.equal(state.slot.index, 1);
    assert.equal(state.slot.shown, 'none');
  } finally { await hub.stop(); }
});

test('serves the surfaces', async () => {
  const { hub, base } = await startHub();
  try {
    assert.match(await (await fetch(`${base}/stage`)).text(), /stage/);
    assert.match(await (await fetch(`${base}/operator`)).text(), /operator/);
    assert.equal((await fetch(`${base}/`)).status, 200);
  } finally { await hub.stop(); }
});

test('serves cards with range support', async () => {
  const { hub, base } = await startHub();
  try {
    const res = await fetch(`${base}/cards/i1-4x9.mp4`, { headers: { Range: 'bytes=0-4' } });
    assert.equal(res.status, 206);
    assert.equal(await res.text(), 'video');
  } finally { await hub.stop(); }
});

test('a command changes the state and persists it', async () => {
  const { hub, base, dir } = await startHub();
  try {
    const res = await post(base, { name: 'reveal' });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).state.slot.shown, 'first');
    assert.ok(existsSync(join(dir, 'state.json')));
    assert.equal(JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')).slots['1'][0].shown, 'first');
  } finally { await hub.stop(); }
});

test('a bad command is a 400 with a sentence, and changes nothing', async () => {
  const { hub, base } = await startHub();
  try {
    const res = await post(base, { name: 'goto', index: 99 });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /no slot 99/);
    assert.equal((await (await fetch(`${base}/api/state`)).json()).slot.index, 1);
  } finally { await hub.stop(); }
});

test('SSE delivers the state on connect and on every change', async () => {
  const { hub, base } = await startHub();
  try {
    const res = await fetch(`${base}/events`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const nextState = async () => {
      for (;;) {
        const m = /event: state\ndata: (.*)\n\n/.exec(buffer);
        if (m) { buffer = buffer.slice(m.index + m[0].length); return JSON.parse(m[1]); }
        const { value, done } = await reader.read();
        if (done) throw new Error('stream ended');
        buffer += decoder.decode(value, { stream: true });
      }
    };
    assert.equal((await nextState()).slot.shown, 'none');
    await post(base, { name: 'reveal' });
    assert.equal((await nextState()).slot.shown, 'first');
    await reader.cancel();
  } finally { await hub.stop(); }
});

test('whoami reports where the console lives', async () => {
  const { hub, base } = await startHub();
  try {
    const who = await (await fetch(`${base}/api/whoami`)).json();
    assert.equal(typeof who.port, 'number');
    assert.ok('operatorUrl' in who);
    assert.ok('mdnsUrl' in who);
  } finally { await hub.stop(); }
});

test('a restart resumes at the same slot', async () => {
  const { hub, base, dir } = await startHub();
  await post(base, { name: 'reveal' });
  await post(base, { name: 'reveal' });
  await post(base, { name: 'next' });
  await hub.stop();
  const again = await createHub({
    showPath: join(dir, 'show.json'), statePath: join(dir, 'state.json'),
    cardsDir: join(dir, 'cards'), publicDir: join(dir, 'public'),
    port: 0, enableSync: false, quiet: true,
  });
  try {
    const state = await (await fetch(`http://127.0.0.1:${again.server.address().port}/api/state`)).json();
    assert.equal(state.slot.index, 2);
    assert.equal(state.completed.length, 1);
  } finally { await again.stop(); }
});

test('with sync on, a command pushes a snapshot and the console sees the status', async () => {
  const pushed = [];
  const fetchImpl = async (url, init) => {
    pushed.push({ url, body: JSON.parse(init.body) });
    return { ok: true, status: 200, json: async () => ({ success: true }) };
  };
  const { hub, base } = await startHub({
    enableSync: true, target: 'staging', fetchImpl,
    password: 'test-password', syncMinDelay: 1,
  });
  try {
    await post(base, { name: 'reveal' });
    for (let i = 0; i < 50 && pushed.length === 0; i++) await new Promise((r) => setTimeout(r, 10));
    assert.equal(pushed.length, 1);
    assert.match(pushed[0].url, /\/pairings$/);
    assert.equal(pushed[0].body.pairings.length, 39);
  } finally { await hub.stop(); }
});

test('AWS being down is invisible to the command path', async () => {
  const fetchImpl = async () => { throw new Error('ENOTFOUND'); };
  const { hub, base } = await startHub({
    enableSync: true, target: 'staging', fetchImpl, password: 'test-password', syncMinDelay: 1,
  });
  try {
    const res = await post(base, { name: 'reveal' });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).state.slot.shown, 'first');
  } finally { await hub.stop(); }
});
```

- [ ] **Step 12: Run it to verify it fails**

Run: `node --test 'party/test/*.test.mjs'`
Expected: FAIL — `Cannot find module '../hub.mjs'`.

- [ ] **Step 13: Implement the hub**

Create `party/hub.mjs`:

```js
#!/usr/bin/env node
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { indexShow } from './build/build-show.mjs';
import { loadState, saveState } from './lib/persist.mjs';
import { reduce, project, CommandError } from './lib/state.mjs';
import { createOutbox } from './lib/outbox.mjs';
import { createSseHub } from './lib/sse.mjs';
import { safeJoin, serveFile } from './lib/static.mjs';
import { pickLanAddress, localHostName, operatorUrls, qrLines, qrSvg } from './lib/net.mjs';
import { API_URLS, loadPassword, putPairings, getPairings } from './lib/aws.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_PORT = 8722;

function landingHtml({ svg, ipUrl, mdnsUrl, stageUrl }) {
  return `<!doctype html><html><head><meta charset="utf-8">
<title>International Cup - pairings party</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
 :root { color-scheme: dark; }
 body { margin:0; min-height:100vh; display:grid; place-items:center; gap:1.5rem;
        background:#0b0d10; color:#f2f3f5; font:16px/1.5 -apple-system,BlinkMacSystemFont,sans-serif;
        padding:2rem; text-align:center; }
 h1 { font-size:1.1rem; letter-spacing:.14em; text-transform:uppercase; color:#FEB619; margin:0; }
 .qr { background:#fff; padding:14px; border-radius:12px; line-height:0; }
 a { color:#f2f3f5; font-size:1.6rem; font-weight:700; text-decoration:none; word-break:break-all; }
 .alt { font-size:1rem; color:#9aa2ad; }
 .alt a { font-size:1rem; font-weight:400; }
</style></head><body>
<h1>Operator console</h1>
<div class="qr">${svg}</div>
<a href="${ipUrl || '/operator'}">${ipUrl || '/operator'}</a>
${mdnsUrl ? `<p class="alt">or, if the address changes: <a href="${mdnsUrl}">${mdnsUrl}</a></p>` : ''}
<p class="alt">Stage: <a href="${stageUrl}">${stageUrl}</a></p>
</body></html>`;
}

export async function createHub({
  showPath = join(HERE, 'show.json'),
  statePath = join(HERE, 'state.json'),
  cardsDir = join(HERE, 'cards'),
  publicDir = join(HERE, 'public'),
  port = DEFAULT_PORT,
  target = 'prod',
  enableSync = true,
  rehearsal = false,
  fetchImpl = fetch,
  password = null,
  syncMinDelay = 1000,
  quiet = false,
} = {}) {
  if (!existsSync(showPath)) {
    throw new Error(`${showPath} is missing. Run: npm run party:build`);
  }
  const show = indexShow(JSON.parse(readFileSync(showPath, 'utf8')));

  const loaded = loadState(statePath, show);
  if (loaded.recovered && !quiet) {
    console.warn(`\n  !! previous state set aside (${loaded.reason}). Starting fresh.\n`);
  }
  let state = { ...loaded.state, rehearsal };

  const sse = createSseHub();
  const apiUrl = API_URLS[target];
  const secret = enableSync ? (password ?? loadPassword({ target })) : null;

  const outbox = createOutbox({
    enabled: enableSync,
    minDelay: syncMinDelay,
    getState: () => state,
    push: (items) => putPairings({ apiUrl, password: secret, items, fetchImpl }),
    onStatus: (sync) => { apply({ name: 'setSync', sync }); },
  });

  function apply(command) {
    const next = reduce(state, command, show);
    if (next === state) return project(state);
    state = next;
    const wire = project(state);
    // Pixels first; the disk write must never be in front of the screen.
    sse.broadcast('state', wire);
    try {
      saveState(statePath, state);
    } catch (e) {
      // A failed local write is bad, but stopping the show over it is worse.
      if (!quiet) console.error(`  !! could not write ${statePath}: ${e.message}`);
    }
    if (command.name !== 'setSync') outbox.markDirty();
    return wire;
  }

  async function refreshFromAws() {
    const items = await getPairings({ apiUrl, fetchImpl });
    let filled = 0;
    for (const item of items) {
      const day = String(item.day);
      const slot = (state.slots[day] || []).find((s) => s.index === item.match_number);
      if (!slot || slot.done || slot.shown !== 'none') continue;
      const intl = item.type === 'team'
        ? [item.intl_team?.player1_id || '', item.intl_team?.player2_id || '']
        : [item.intl_player_id || ''];
      const usa = item.type === 'team'
        ? [item.usa_team?.player1_id || '', item.usa_team?.player2_id || '']
        : [item.usa_player_id || ''];
      for (const [side, ids] of [['intl', intl], ['usa', usa]]) {
        if (ids.every((id) => !id)) continue;
        if (slot[side].some(Boolean)) continue;
        if (!ids.every((id) => !id || show.byId[id])) continue;
        slot[side] = ids;
        filled += 1;
      }
    }
    if (filled) {
      state = { ...state, rev: state.rev + 1 };
      sse.broadcast('state', project(state));
      try { saveState(statePath, state); } catch { /* see apply() */ }
    }
    return filled;
  }

  const server = createServer(async (req, res) => {
    const url = req.url.split('?')[0];

    if (req.method === 'POST' && url === '/api/command') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', async () => {
        let command;
        try { command = JSON.parse(body || '{}'); } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: false, error: 'body is not JSON' }));
          return;
        }
        try {
          if (command.name === 'refreshFromAws') {
            const filled = await refreshFromAws();
            res.writeHead(200, { 'Content-Type': 'application/json' })
              .end(JSON.stringify({ ok: true, filled, state: project(state) }));
            return;
          }
          const wire = apply(command);
          res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true, state: wire }));
        } catch (e) {
          const code = e instanceof CommandError ? 400 : 500;
          res.writeHead(code, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: false, error: e.message }));
        }
      });
      return;
    }

    if (url === '/events') { sse.attach(req, res); return; }

    if (url === '/api/state') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        .end(JSON.stringify(project(state)));
      return;
    }

    if (url === '/api/show') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        .end(JSON.stringify(show));
      return;
    }

    if (url === '/api/whoami') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        .end(JSON.stringify(whoami()));
      return;
    }

    if (url === '/' ) {
      const who = whoami();
      const svg = qrSvg(who.operatorUrl || `http://localhost:${who.port}/operator`, 6);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
        .end(landingHtml({ svg, ipUrl: who.operatorUrl, mdnsUrl: who.mdnsUrl, stageUrl: who.stageUrl }));
      return;
    }

    if (url === '/operator' || url === '/stage') {
      serveFile(req, res, join(publicDir, `${url.slice(1)}.html`));
      return;
    }

    if (url.startsWith('/cards/')) {
      const abs = safeJoin(cardsDir, url.slice('/cards'.length));
      if (!abs) { res.writeHead(403).end(); return; }
      serveFile(req, res, abs);
      return;
    }

    const abs = safeJoin(publicDir, url);
    if (!abs) { res.writeHead(403).end(); return; }
    serveFile(req, res, abs);
  });

  function whoami() {
    const lan = pickLanAddress(networkInterfaces());
    const hostName = localHostName();
    const actualPort = server.address()?.port ?? port;
    const urls = operatorUrls({ address: lan?.address, hostName, port: actualPort });
    return {
      port: actualPort,
      iface: lan?.iface || null,
      address: lan?.address || null,
      hostName,
      operatorUrl: urls.ip,
      mdnsUrl: urls.mdns,
      stageUrl: `http://localhost:${actualPort}/stage`,
      clients: sse.count(),
      rehearsal,
      sync: enableSync ? target : 'off',
    };
  }

  await new Promise((ok) => server.listen(port, '0.0.0.0', ok));

  return {
    server,
    whoami,
    get state() { return state; },
    async stop() {
      outbox.stop();
      sse.closeAll();
      await new Promise((ok) => server.close(ok));
    },
  };
}

function parseArgs(argv) {
  const args = { port: DEFAULT_PORT, target: 'prod', enableSync: true, rehearsal: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--port') args.port = Number(argv[++i]);
    else if (argv[i] === '--target') args.target = argv[++i];
    else if (argv[i] === '--no-sync') args.enableSync = false;
    else if (argv[i] === '--rehearsal') { args.rehearsal = true; args.enableSync = false; }
  }
  if (args.rehearsal) args.statePath = join(HERE, 'state.rehearsal.json');
  return args;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const hub = await createHub(args);
  const who = hub.whoami();
  const operator = who.operatorUrl || `http://localhost:${who.port}/operator`;
  console.log('');
  for (const line of qrLines(operator)) console.log(`  ${line}`);
  console.log('');
  console.log(`  Operator   ${operator}`);
  if (who.mdnsUrl) console.log(`  or         ${who.mdnsUrl}`);
  console.log(`  Stage      ${who.stageUrl}`);
  console.log(`  Landing    http://localhost:${who.port}/`);
  console.log(`  Sync       ${who.sync}${args.rehearsal ? '  (REHEARSAL - nothing reaches AWS)' : ''}`);
  console.log('');
  process.on('SIGINT', async () => { await hub.stop(); process.exit(0); });
}
```

- [ ] **Step 14: Add placeholder surfaces so the hub can serve something**

```bash
printf '<!doctype html><meta charset="utf-8"><title>Stage</title><h1>stage</h1>\n' > party/public/stage.html
printf '<!doctype html><meta charset="utf-8"><title>Operator</title><h1>operator</h1>\n' > party/public/operator.html
```

- [ ] **Step 15: Run the tests**

Run: `node --test 'party/test/*.test.mjs'`
Expected: PASS, 101 tests.

- [ ] **Step 16: Start it and look**

```bash
npm run party:start -- --no-sync
```

Expected: a QR code in the terminal, then four URLs. Scan the QR with your phone on the same wifi — it should open the placeholder operator page. Open `http://localhost:8722/` in a browser: the same QR, large, with the address under it. `Ctrl-C` to stop.

- [ ] **Step 17: Commit**

```bash
git add party/hub.mjs party/lib/net.mjs party/lib/static.mjs party/lib/sse.mjs party/vendor/qrcode.js party/public party/test/
git commit -m "$(cat <<'EOF'
feat(party): the hub - static serving, SSE, commands, QR addressing

Byte ranges are served properly, because Safari will not play a video without
them. The address comes from scutil's LocalHostName, not os.hostname, which on
this laptop is a name that does not resolve.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013XspHF9gopSSxm6j3nkjGb
EOF
)"
```

---

### Task 10: The stage

**Files:**
- Create: `party/public/panels.mjs`, `party/public/stage.html`, `party/public/stage.css`, `party/public/stage.js`, `party/test/panels.test.mjs`
- Replace: the `party/public/stage.html` placeholder from Task 9

**Interfaces:**
- Consumes: the `Wire` shape (Task 5), the `Show` shape with `cards` and `fallback` (Task 4), `GET /api/show`, `GET /events`.
- Produces (`party/public/panels.mjs`, an ES module loaded by both the browser and `node --test`):
  - `formatFor(day) -> '4x9' | '8x9'`
  - `perSide(day) -> 2 | 1`
  - `panelPlan(wire, show) -> { fmt, panels: Panel[] }`
  - `panelsForMatch(match, show) -> { fmt, panels: Panel[] }` — every panel visible; used by the slideshow
  - `preloadSrcs(wire, show) -> string[]`
  - `slideshowEntry(wire) -> completedEntry | null`
  - `Panel = { key, side, pos, playerId, name, src, fallback, visible }`

**Why a separate pure module.** The stage's only real logic is "which clip belongs in which of the four boxes, and is it showing yet". Pulling that out means it can be tested in Node without a browser, and `stage.js` is reduced to applying the plan to the DOM.

**Panel order is fixed: `intl-0, intl-1, usa-0, usa-1`, left to right** (§5.5). International always occupies the left half whichever side reveals first.

**The diffing rule, which matters more than it looks.** `stage.js` must only touch a panel whose `playerId` has changed. Reassigning `src` to the clip already in a panel reloads it, and a card that has played and is holding its final frame would visibly flash back to black mid-reveal. Diff first, then act.

**Play once and hold.** No `loop` attribute. A `<video>` holds its last frame when it ends, so the final frame — which carries the name, hometown and school — is the information panel. Nothing extra to build.

**Autoplay.** Browsers block autoplay without a user gesture. The cards have no audio track at all, so `muted` + `playsinline` is enough in Chrome and Safari, but the stage still shows a full-screen "Tap to start" cover until the first click, and uses that click to prime playback. One click on the laptop at setup, then never again.

- [ ] **Step 1: Write the failing test**

Create `party/test/panels.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatFor, perSide, panelPlan, panelsForMatch, preloadSrcs, slideshowEntry } from '../public/panels.mjs';
import { indexShow } from '../build/build-show.mjs';

function makeShow() {
  const players = [];
  const mk = (id, team, name) => ({
    id, team, name, country: team === 'usa' ? 'USA' : 'India', hometown: '', school: '', generic: true,
    cards: { '4x9': `cards/${id}-4x9.mp4`, '8x9': `cards/${id}-8x9.mp4` },
    fallback: { '4x9': `cards/${id}-4x9.mp4`, '8x9': `cards/${id}-8x9.mp4` },
  });
  for (let i = 1; i <= 26; i++) players.push(mk(`player-intl-${i}`, 'international', `I${i}`));
  for (let i = 1; i <= 26; i++) players.push(mk(`player-usa-${i}`, 'usa', `U${i}`));
  return indexShow({ built: 'now', players, days: { 1: [], 2: [] } });
}
const show = makeShow();

const wire = (over = {}) => ({
  day: 1, mode: 'live', rev: 1, rehearsal: false,
  slot: { index: 1, firstSide: 'intl', intl: ['player-intl-1', 'player-intl-2'],
    usa: ['player-usa-1', 'player-usa-2'], shown: 'none', problems: [] },
  next: { intl: ['player-intl-3', 'player-intl-4'], usa: ['', ''] },
  completed: [], slideshow: { position: 0, dwellSeconds: 12 },
  sync: { dirty: false, lastPushed: null, lastError: null },
  ...over,
});

test('day 1 is four 4x9 panels, day 2 is two 8x9', () => {
  assert.equal(formatFor(1), '4x9');
  assert.equal(formatFor(2), '8x9');
  assert.equal(perSide(1), 2);
  assert.equal(perSide(2), 1);
  assert.equal(panelPlan(wire(), show).panels.length, 4);
  assert.equal(panelPlan(wire({ day: 2, slot: { ...wire().slot, intl: ['player-intl-1'], usa: ['player-usa-1'] } }), show).panels.length, 2);
});

test('International is always the left half, whoever reveals first', () => {
  for (const firstSide of ['intl', 'usa']) {
    const plan = panelPlan(wire({ slot: { ...wire().slot, firstSide } }), show);
    assert.deepEqual(plan.panels.map((p) => p.key), ['intl-0', 'intl-1', 'usa-0', 'usa-1']);
  }
});

test('nothing is visible before the first reveal', () => {
  assert.deepEqual(panelPlan(wire(), show).panels.map((p) => p.visible), [false, false, false, false]);
});

test('the first reveal lights only the first side', () => {
  const intlFirst = panelPlan(wire({ slot: { ...wire().slot, shown: 'first', firstSide: 'intl' } }), show);
  assert.deepEqual(intlFirst.panels.map((p) => p.visible), [true, true, false, false]);
  const usaFirst = panelPlan(wire({ slot: { ...wire().slot, shown: 'first', firstSide: 'usa' } }), show);
  assert.deepEqual(usaFirst.panels.map((p) => p.visible), [false, false, true, true]);
});

test('both lights everything', () => {
  const plan = panelPlan(wire({ slot: { ...wire().slot, shown: 'both' } }), show);
  assert.deepEqual(plan.panels.map((p) => p.visible), [true, true, true, true]);
});

test('an unfilled side stays dark even when revealed', () => {
  const plan = panelPlan(wire({ slot: { ...wire().slot, usa: ['', ''], shown: 'both' } }), show);
  assert.deepEqual(plan.panels.map((p) => p.visible), [true, true, false, false]);
  assert.equal(plan.panels[2].src, null);
  assert.equal(plan.panels[2].playerId, null);
});

test('a panel carries the clip, the fallback and the name', () => {
  const [p] = panelPlan(wire(), show).panels;
  assert.equal(p.src, 'cards/player-intl-1-4x9.mp4');
  assert.equal(p.fallback, 'cards/player-intl-1-4x9.mp4');
  assert.equal(p.name, 'I1');
});

test('a player id the show does not know does not throw', () => {
  const plan = panelPlan(wire({ slot: { ...wire().slot, usa: ['ghost', 'player-usa-2'] } }), show);
  assert.equal(plan.panels[2].src, null);
  assert.equal(plan.panels[2].name, '');
});

test('preload lists the next slot, both sides, skipping blanks', () => {
  assert.deepEqual(preloadSrcs(wire(), show), ['cards/player-intl-3-4x9.mp4', 'cards/player-intl-4-4x9.mp4']);
  assert.deepEqual(preloadSrcs(wire({ next: { intl: [], usa: [] } }), show), []);
});

test('the slideshow walks completed matches and wraps', () => {
  const completed = [
    { day: 1, index: 1, intl: ['player-intl-1', 'player-intl-2'], usa: ['player-usa-1', 'player-usa-2'] },
    { day: 2, index: 1, intl: ['player-intl-3'], usa: ['player-usa-3'] },
  ];
  assert.equal(slideshowEntry(wire({ completed, slideshow: { position: 0, dwellSeconds: 12 } })).day, 1);
  assert.equal(slideshowEntry(wire({ completed, slideshow: { position: 1, dwellSeconds: 12 } })).day, 2);
  assert.equal(slideshowEntry(wire({ completed, slideshow: { position: 2, dwellSeconds: 12 } })).day, 1);
  assert.equal(slideshowEntry(wire({ completed: [], slideshow: { position: 0, dwellSeconds: 12 } })), null);
});

test('a slideshow match shows every panel at once and picks the format from its own day', () => {
  const plan = panelsForMatch({ day: 2, index: 1, intl: ['player-intl-3'], usa: ['player-usa-3'] }, show);
  assert.equal(plan.fmt, '8x9');
  assert.equal(plan.panels.length, 2);
  assert.ok(plan.panels.every((p) => p.visible));
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test 'party/test/*.test.mjs'`
Expected: FAIL — `Cannot find module '../public/panels.mjs'`.

- [ ] **Step 3: Implement the planner**

Create `party/public/panels.mjs`:

```js
export const SIDES = ['intl', 'usa'];

export function formatFor(day) { return day === 1 ? '4x9' : '8x9'; }
export function perSide(day) { return day === 1 ? 2 : 1; }

function makePanel(show, fmt, side, pos, playerId, visible) {
  const player = playerId ? show.byId[playerId] : null;
  return {
    key: `${side}-${pos}`,
    side,
    pos,
    playerId: player ? playerId : null,
    name: player ? player.name : '',
    src: player ? player.cards[fmt] : null,
    fallback: player ? player.fallback[fmt] : null,
    visible: Boolean(player) && visible,
  };
}

export function panelPlan(wire, show) {
  const fmt = formatFor(wire.day);
  const n = perSide(wire.day);
  const panels = [];
  for (const side of SIDES) {
    const revealed = wire.slot.shown === 'both'
      || (wire.slot.shown === 'first' && side === wire.slot.firstSide);
    for (let pos = 0; pos < n; pos++) {
      panels.push(makePanel(show, fmt, side, pos, (wire.slot[side] || [])[pos] || null, revealed));
    }
  }
  return { fmt, panels };
}

export function panelsForMatch(match, show) {
  const fmt = formatFor(match.day);
  const n = perSide(match.day);
  const panels = [];
  for (const side of SIDES) {
    for (let pos = 0; pos < n; pos++) {
      panels.push(makePanel(show, fmt, side, pos, (match[side] || [])[pos] || null, true));
    }
  }
  return { fmt, panels };
}

export function preloadSrcs(wire, show) {
  const fmt = formatFor(wire.day);
  const ids = [...(wire.next.intl || []), ...(wire.next.usa || [])].filter(Boolean);
  return ids.map((id) => show.byId[id]).filter(Boolean).map((p) => p.cards[fmt]);
}

export function slideshowEntry(wire) {
  const all = wire.completed || [];
  if (all.length === 0) return null;
  return all[wire.slideshow.position % all.length];
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test 'party/test/*.test.mjs'`
Expected: PASS, 112 tests.

- [ ] **Step 5: Write the stage markup**

Replace `party/public/stage.html`:

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>International Cup — Stage</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/stage.css">
</head>
<body>
  <div id="layer-a" class="layer live"></div>
  <div id="layer-b" class="layer"></div>
  <div id="preload" aria-hidden="true"></div>
  <div id="cover"><p>Tap to start</p></div>
  <script type="module" src="/stage.js"></script>
</body>
</html>
```

- [ ] **Step 6: Write the stage styles**

Create `party/public/stage.css`:

```css
* { margin: 0; padding: 0; box-sizing: border-box; }

html, body {
  width: 100%; height: 100%;
  background: #000;
  overflow: hidden;
  cursor: none;
}

.layer {
  position: absolute; inset: 0;
  display: flex;
  opacity: 0;
  transition: opacity 600ms ease-in-out;
}
.layer.live { opacity: 1; }

.panel {
  position: relative;
  flex: 1 1 0;
  height: 100%;
  background: #000;
  overflow: hidden;
}

.panel video {
  width: 100%; height: 100%;
  object-fit: cover;
  opacity: 0;
  transition: opacity 180ms linear;
}
.panel.shown video { opacity: 1; }

/* A panel whose clip will not play at all: the name, so the slot is never blank. */
.panel .fallback-name {
  position: absolute; inset: auto 0 12%;
  text-align: center;
  font: 700 2.2vw/1.2 -apple-system, BlinkMacSystemFont, Arial, sans-serif;
  letter-spacing: .06em;
  color: #fff;
  opacity: 0;
}
.panel.text-only .fallback-name { opacity: 1; }

#preload { position: absolute; width: 0; height: 0; overflow: hidden; }

#cover {
  position: absolute; inset: 0;
  display: grid; place-items: center;
  background: #000;
  cursor: pointer;
  z-index: 10;
}
#cover p {
  font: 400 1.6vw/1 -apple-system, BlinkMacSystemFont, Arial, sans-serif;
  letter-spacing: .3em; text-transform: uppercase; color: #FEB619;
}
#cover.gone { display: none; }
```

- [ ] **Step 7: Write the stage behaviour**

Create `party/public/stage.js`:

```js
import { panelPlan, panelsForMatch, preloadSrcs, slideshowEntry } from '/panels.mjs';

const layers = { a: document.getElementById('layer-a'), b: document.getElementById('layer-b') };
const preloadBox = document.getElementById('preload');
const cover = document.getElementById('cover');

let show = null;
let wire = null;
let live = 'a';            // which layer is on screen
let primed = false;        // has the user clicked once
let slideTimer = null;
let slidePosition = 0;

cover.addEventListener('click', () => {
  primed = true;
  cover.classList.add('gone');
  for (const v of document.querySelectorAll('video')) v.play().catch(() => {});
  if (wire) render();
});

function makePanelEl(panel) {
  const el = document.createElement('div');
  el.className = 'panel';
  el.dataset.key = panel.key;
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  const name = document.createElement('div');
  name.className = 'fallback-name';
  el.append(video, name);
  return el;
}

// Swap to the fallback clip once; if that fails too, show the name.
function attachErrorHandling(video, panelEl, panel) {
  video.onerror = () => {
    if (panel.fallback && video.dataset.triedFallback !== '1' && !video.src.endsWith(panel.fallback)) {
      video.dataset.triedFallback = '1';
      video.src = `/${panel.fallback}`;
      video.load();
      if (panel.visible) video.play().catch(() => {});
      return;
    }
    panelEl.classList.add('text-only');
  };
}

function applyPlan(container, plan, { force = false } = {}) {
  if (container.dataset.fmt !== plan.fmt || container.children.length !== plan.panels.length) {
    container.replaceChildren(...plan.panels.map(makePanelEl));
    container.dataset.fmt = plan.fmt;
  }
  plan.panels.forEach((panel, i) => {
    const el = container.children[i];
    const video = el.querySelector('video');
    el.querySelector('.fallback-name').textContent = panel.name;

    // Only touch a panel whose player changed. Re-assigning src to the clip
    // already held would reload it and flash the screen black mid-reveal.
    const changed = force || el.dataset.playerId !== String(panel.playerId);
    if (changed) {
      el.dataset.playerId = String(panel.playerId);
      el.classList.remove('text-only');
      delete video.dataset.triedFallback;
      delete video.dataset.started;
      if (panel.src) {
        attachErrorHandling(video, el, panel);
        video.src = `/${panel.src}`;
        video.load();
      } else {
        video.removeAttribute('src');
        video.load();
      }
    }

    el.classList.toggle('shown', panel.visible);
    if (panel.visible && panel.src && primed && video.dataset.started !== '1') {
      video.dataset.started = '1';
      video.currentTime = 0;
      video.play().catch(() => {});
    }
  });
}

function applyPreload() {
  const want = preloadSrcs(wire, show);
  const have = [...preloadBox.children].map((v) => v.dataset.rel);
  if (want.join('|') === have.join('|')) return;
  preloadBox.replaceChildren(...want.map((rel) => {
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto';
    v.dataset.rel = rel;
    v.src = `/${rel}`;
    return v;
  }));
}

function renderLive() {
  if (slideTimer) { clearTimeout(slideTimer); slideTimer = null; }
  applyPlan(layers[live], panelPlan(wire, show));
  layers[live].classList.add('live');
  layers[live === 'a' ? 'b' : 'a'].classList.remove('live');
  applyPreload();
}

function renderSlideshow() {
  if (slideTimer) { clearTimeout(slideTimer); slideTimer = null; }
  const all = wire.completed || [];
  if (all.length === 0) return;
  const entry = all[slidePosition % all.length];
  const back = live === 'a' ? 'b' : 'a';
  applyPlan(layers[back], panelsForMatch(entry, show), { force: true });
  layers[back].classList.add('live');
  layers[live].classList.remove('live');
  live = back;
  slideTimer = setTimeout(() => {
    slidePosition += 1;
    renderSlideshow();
  }, (wire.slideshow.dwellSeconds || 12) * 1000 + 600);
}

function render() {
  if (!show || !wire) return;
  if (wire.mode === 'slideshow') {
    if (!slideTimer) { slidePosition = wire.slideshow.position || 0; renderSlideshow(); }
  } else {
    renderLive();
  }
}

async function boot() {
  show = await (await fetch('/api/show')).json();
  show.byId = Object.fromEntries(show.players.map((p) => [p.id, p]));
  wire = await (await fetch('/api/state')).json();
  render();

  const events = new EventSource('/events');
  events.addEventListener('state', (e) => {
    const incoming = JSON.parse(e.data);
    const wasSlideshow = wire && wire.mode === 'slideshow';
    wire = incoming;
    if (wasSlideshow && wire.mode !== 'slideshow' && slideTimer) {
      clearTimeout(slideTimer); slideTimer = null;
    }
    render();
  });
  // EventSource reconnects by itself; re-pull the whole state when it does
  // rather than assuming nothing was missed.
  events.onerror = () => {
    setTimeout(async () => {
      try { wire = await (await fetch('/api/state')).json(); render(); } catch { /* retry on next error */ }
    }, 1500);
  };
}

boot();
```

- [ ] **Step 8: Walk it in a browser**

```bash
npm run party:start -- --no-sync
```

Open `http://localhost:8722/stage` and `http://localhost:8722/operator` side by side. Click the stage once to clear the cover. Then, from a terminal:

```bash
P=http://localhost:8722/api/command
post () { curl -s -X POST $P -H 'Content-Type: application/json' -d "$1" >/dev/null; }
post '{"name":"reveal"}'                                                      # left half plays, right stays dark
post '{"name":"assign","side":"usa","players":["player-usa-1","player-usa-2"]}'
post '{"name":"reveal"}'                                                      # right half plays, left keeps its held frame
post '{"name":"next"}'                                                        # next pair pre-fills
post '{"name":"setFirstSide","side":"usa"}'
post '{"name":"reveal"}'                                                      # right half first, left waiting
```

Check, in order: four narrow panels fill the screen with no gaps or letterboxing; the left two play and hold their final frame with the name block up; revealing the right half does **not** restart or flash the left; no cursor; no scrollbars.

- [ ] **Step 9: Commit**

```bash
git add party/public/panels.mjs party/public/stage.html party/public/stage.css party/public/stage.js party/test/panels.test.mjs
git commit -m "$(cat <<'EOF'
feat(party): the stage

Panels are diffed by player, so revealing the second side never disturbs the
first. Cards play once and hold their final frame, which is the information
panel, so nothing loops while a captain is talking.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013XspHF9gopSSxm6j3nkjGb
EOF
)"
```

---

### Task 11: The operator console

**Files:**
- Create: `party/public/console.mjs`, `party/public/operator.html`, `party/public/operator.css`, `party/public/operator.js`, `party/test/console.test.mjs`
- Replace: the `party/public/operator.html` placeholder from Task 9

**Interfaces:**
- Consumes: the `Wire` shape (Task 5), `Show` (Task 4), `POST /api/command`, `GET /events`, `GET /api/whoami`.
- Produces (`party/public/console.mjs`):
  - `rosterFor(show, side) -> Player[]` — that side's players, sorted by surname
  - `nameOf(show, id) -> string`
  - `syncLabel(sync) -> { text, tone: 'ok'|'pending'|'offline' }`
  - `describeProblems(problems, show) -> string[]` — ids swapped for names
  - `slotLabel(wire) -> string` — e.g. `Day 1 · Match 3 of 13`

**One deliberate deviation from the spec.** §4.4 asks for an indicator reading "synced / *n* pending / offline". A snapshot flusher has no queue, so there is no *n* to show — there is one outstanding snapshot or none. The indicator shows `Synced 23:41:02`, `Syncing…` or `Offline — last synced 23:38:10`, which is the information that actually matters: whether AWS has what is on screen, and if not, how stale it is.

**Touch targets.** This is operated on an iPad, standing up, in a pub, by someone who is also listening to a captain. Buttons are large, the primary action is unmissable, and nothing destructive sits next to it. **Reveal** and **Next** are the two big ones; **Undo** is deliberately placed away from them.

- [ ] **Step 1: Write the failing test**

Create `party/test/console.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rosterFor, nameOf, syncLabel, describeProblems, slotLabel } from '../public/console.mjs';
import { indexShow } from '../build/build-show.mjs';

const show = indexShow({
  built: 'now',
  players: [
    { id: 'player-intl-1', team: 'international', name: 'Ashvini Anjutgi', country: 'India' },
    { id: 'player-intl-2', team: 'international', name: 'Alba Phillips', country: 'Spain' },
    { id: 'player-usa-1', team: 'usa', name: 'John Altman', country: 'USA' },
    { id: 'player-usa-2', team: 'usa', name: 'Frank Ambrose', country: 'USA' },
  ],
  days: { 1: [], 2: [] },
});

test('each side lists only its own players, by surname', () => {
  assert.deepEqual(rosterFor(show, 'intl').map((p) => p.name), ['Ashvini Anjutgi', 'Alba Phillips']);
  assert.deepEqual(rosterFor(show, 'usa').map((p) => p.name), ['John Altman', 'Frank Ambrose']);
});

test('nameOf copes with a blank or unknown id', () => {
  assert.equal(nameOf(show, 'player-usa-1'), 'John Altman');
  assert.equal(nameOf(show, ''), '');
  assert.equal(nameOf(show, 'ghost'), 'ghost');
});

test('the sync indicator says whether AWS has what is on screen', () => {
  assert.deepEqual(syncLabel({ dirty: false, lastPushed: '2026-10-22T23:41:02.000Z', lastError: null }),
    { text: 'Synced 23:41:02', tone: 'ok' });
  assert.deepEqual(syncLabel({ dirty: true, lastPushed: null, lastError: null }),
    { text: 'Syncing…', tone: 'pending' });
  assert.deepEqual(syncLabel({ dirty: true, lastPushed: '2026-10-22T23:38:10.000Z', lastError: 'pairings POST returned HTTP 503' }),
    { text: 'Offline — last synced 23:38:10', tone: 'offline' });
  assert.deepEqual(syncLabel({ dirty: true, lastPushed: null, lastError: 'ENOTFOUND' }),
    { text: 'Offline — never synced', tone: 'offline' });
  assert.deepEqual(syncLabel({ dirty: false, lastPushed: null, lastError: null }),
    { text: 'Sync off', tone: 'ok' });
});

// REVIEW FOCUS 5: the operator must read a name, not a player id, under pressure.
test('problems are reported with names', () => {
  assert.deepEqual(
    describeProblems(['player-usa-1 appears twice in this match', 'player-usa-2 is already in match 4'], show),
    ['John Altman appears twice in this match', 'Frank Ambrose is already in match 4'],
  );
});

test('the slot label says where you are', () => {
  assert.equal(slotLabel({ day: 1, slot: { index: 3 } }), 'Day 1 · Match 3 of 13');
  assert.equal(slotLabel({ day: 2, slot: { index: 26 } }), 'Day 2 · Match 26 of 26');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test 'party/test/*.test.mjs'`
Expected: FAIL — `Cannot find module '../public/console.mjs'`.

- [ ] **Step 3: Implement the console helpers**

Create `party/public/console.mjs`:

```js
const TEAM_OF = { intl: 'international', usa: 'usa' };
const COUNT = { 1: 13, 2: 26 };

const surname = (name) => name.trim().split(/\s+/).slice(-1)[0].toLowerCase();

export function rosterFor(show, side) {
  return show.players
    .filter((p) => p.team === TEAM_OF[side])
    .sort((a, b) => surname(a.name).localeCompare(surname(b.name)));
}

export function nameOf(show, id) {
  if (!id) return '';
  const p = show.byId[id];
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
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test 'party/test/*.test.mjs'`
Expected: PASS, 117 tests.

- [ ] **Step 5: Write the console markup**

Replace `party/public/operator.html`:

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>International Cup — Operator</title>
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<link rel="stylesheet" href="/operator.css">
</head>
<body>
<header>
  <div id="slot-label">—</div>
  <div id="sync" class="sync">—</div>
</header>

<section id="problems" class="problems" hidden></section>

<main>
  <section class="pane">
    <h2>On screen</h2>
    <div class="sides">
      <div class="side" data-side="intl"><h3>International <span class="first-tag">reveals first</span></h3><div class="picks"></div></div>
      <div class="side" data-side="usa"><h3>USA <span class="first-tag">reveals first</span></h3><div class="picks"></div></div>
    </div>
    <button id="toggle-first" class="btn btn-quiet">Swap which side reveals first</button>
  </section>

  <section class="pane next">
    <h2>Up next</h2>
    <div id="next-summary">—</div>
  </section>
</main>

<nav class="actions">
  <button id="reveal" class="btn btn-primary">Reveal</button>
  <button id="next" class="btn btn-primary">Next match</button>
</nav>

<nav class="actions secondary">
  <button id="day1" class="btn">Day 1</button>
  <button id="day2" class="btn">Day 2</button>
  <button id="jump" class="btn">Jump to…</button>
  <button id="slideshow" class="btn">Slideshow</button>
  <button id="refresh" class="btn">Refresh from AWS</button>
  <button id="undo" class="btn btn-danger">Undo</button>
</nav>

<dialog id="picker">
  <h3 id="picker-title">Pick a player</h3>
  <input id="picker-filter" type="search" placeholder="Type a name" autocomplete="off">
  <ul id="picker-list"></ul>
  <button id="picker-cancel" class="btn">Cancel</button>
</dialog>

<dialog id="jumper">
  <h3>Jump to match</h3>
  <ul id="jumper-list"></ul>
  <button id="jumper-cancel" class="btn">Cancel</button>
</dialog>

<script type="module" src="/operator.js"></script>
</body>
</html>
```

- [ ] **Step 6: Write the console styles**

Create `party/public/operator.css`:

```css
* { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }

:root {
  --bg: #0b0d10;
  --panel: #161a20;
  --line: #262c35;
  --ink: #f2f3f5;
  --dim: #9aa2ad;
  --gold: #FEB619;
  --ok: #4ade80;
  --warn: #fbbf24;
  --bad: #f87171;
  color-scheme: dark;
}

body {
  margin: 0;
  padding: env(safe-area-inset-top) 16px calc(env(safe-area-inset-bottom) + 16px);
  background: var(--bg);
  color: var(--ink);
  font: 17px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  user-select: none;
}

header {
  display: flex; align-items: baseline; justify-content: space-between;
  gap: 12px; padding: 14px 0;
}
#slot-label { font-size: 1.25rem; font-weight: 700; letter-spacing: .02em; }
.sync { font-size: .85rem; color: var(--dim); }
.sync[data-tone="ok"] { color: var(--ok); }
.sync[data-tone="pending"] { color: var(--warn); }
.sync[data-tone="offline"] { color: var(--bad); }

.problems {
  background: #3b1d1d; border: 1px solid var(--bad); border-radius: 10px;
  padding: 10px 14px; margin-bottom: 12px; color: #ffd9d9; font-size: .95rem;
}
.problems ul { margin: 0; padding-left: 18px; }

.pane {
  background: var(--panel); border: 1px solid var(--line);
  border-radius: 14px; padding: 14px; margin-bottom: 12px;
}
.pane h2 {
  margin: 0 0 10px; font-size: .75rem; letter-spacing: .18em;
  text-transform: uppercase; color: var(--dim);
}
.pane.next { opacity: .75; }
#next-summary { color: var(--dim); }

.sides { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.side h3 { margin: 0 0 8px; font-size: .95rem; font-weight: 700; }
.first-tag { display: none; font-size: .7rem; color: var(--gold); letter-spacing: .1em; text-transform: uppercase; }
.side.is-first .first-tag { display: inline; }

.picks { display: grid; gap: 8px; }
.pick {
  width: 100%; min-height: 56px; text-align: left;
  background: #1f252d; border: 1px solid var(--line); border-radius: 10px;
  color: var(--ink); font: inherit; font-weight: 600; padding: 10px 12px;
}
.pick.empty { color: var(--dim); font-weight: 400; font-style: italic; }
.pick.revealed { border-color: var(--gold); }

.btn {
  min-height: 56px; padding: 0 16px;
  background: #1f252d; border: 1px solid var(--line); border-radius: 12px;
  color: var(--ink); font: inherit; font-weight: 600;
}
.btn:active { transform: translateY(1px); }
.btn-quiet { width: 100%; margin-top: 12px; min-height: 48px; color: var(--dim); font-weight: 400; }
.btn-primary { background: var(--gold); border-color: var(--gold); color: #10131a; font-size: 1.15rem; min-height: 76px; }
.btn-danger { border-color: #5b2a2a; color: #ffb4b4; }
.btn[disabled] { opacity: .35; }

.actions { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px; }
.actions.secondary { grid-template-columns: repeat(3, 1fr); }

dialog {
  width: min(560px, 92vw); max-height: 80vh;
  background: var(--panel); color: var(--ink);
  border: 1px solid var(--line); border-radius: 16px; padding: 16px;
}
dialog::backdrop { background: rgba(0,0,0,.72); }
dialog h3 { margin: 0 0 12px; }
#picker-filter {
  width: 100%; min-height: 52px; margin-bottom: 12px; padding: 0 12px;
  background: #11151b; border: 1px solid var(--line); border-radius: 10px;
  color: var(--ink); font: inherit;
}
dialog ul { list-style: none; margin: 0 0 12px; padding: 0; max-height: 48vh; overflow: auto; }
dialog li button {
  width: 100%; min-height: 54px; text-align: left; margin-bottom: 6px;
  background: #1f252d; border: 1px solid var(--line); border-radius: 10px;
  color: var(--ink); font: inherit; padding: 0 12px;
}
dialog li button .meta { color: var(--dim); font-size: .85rem; }

@media (max-width: 560px) {
  .sides { grid-template-columns: 1fr; }
  .actions.secondary { grid-template-columns: 1fr 1fr; }
}
```

- [ ] **Step 7: Write the console behaviour**

Create `party/public/operator.js`:

```js
import { rosterFor, nameOf, syncLabel, describeProblems, slotLabel } from '/console.mjs';

const $ = (id) => document.getElementById(id);
let show = null;
let wire = null;

async function send(command) {
  const res = await fetch('/api/command', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  const body = await res.json();
  if (!body.ok) {
    alert(body.error);           // the hub rejected it; the operator needs to know why
    return null;
  }
  if (body.state) { wire = body.state; render(); }
  if (typeof body.filled === 'number') alert(`Filled ${body.filled} side(s) from AWS.`);
  return body;
}

function perSide() { return wire.day === 1 ? 2 : 1; }

function openPicker(side, pos) {
  const dialog = $('picker');
  const list = $('picker-list');
  const filter = $('picker-filter');
  $('picker-title').textContent = side === 'intl' ? 'International player' : 'USA player';

  const taken = new Set([...(wire.slot.intl || []), ...(wire.slot.usa || [])].filter(Boolean));

  const paint = () => {
    const q = filter.value.trim().toLowerCase();
    list.replaceChildren(...rosterFor(show, side)
      .filter((p) => !q || p.name.toLowerCase().includes(q))
      .map((p) => {
        const li = document.createElement('li');
        const b = document.createElement('button');
        b.innerHTML = `${p.name}${taken.has(p.id) ? ' <span class="meta">· already in this match</span>' : ''}`;
        b.onclick = async () => {
          const players = [...(wire.slot[side] || [])];
          while (players.length < perSide()) players.push('');
          players[pos] = p.id;
          dialog.close();
          await send({ name: 'assign', side, players });
        };
        li.append(b);
        return li;
      }));
  };

  filter.value = '';
  filter.oninput = paint;
  paint();
  dialog.showModal();
}

function openJumper() {
  const dialog = $('jumper');
  const total = wire.day === 1 ? 13 : 26;
  const list = $('jumper-list');
  list.replaceChildren(...Array.from({ length: total }, (_, i) => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    const done = (wire.completed || []).some((c) => c.day === wire.day && c.index === i + 1);
    b.innerHTML = `Match ${i + 1}${done ? ' <span class="meta">· done, reopens it</span>' : ''}`;
    b.onclick = async () => {
      dialog.close();
      await send(done ? { name: 'reopen', day: wire.day, index: i } : { name: 'goto', index: i });
    };
    li.append(b);
    return li;
  }));
  dialog.showModal();
}

function renderSide(side) {
  const box = document.querySelector(`.side[data-side="${side}"]`);
  box.classList.toggle('is-first', wire.slot.firstSide === side);
  const revealed = wire.slot.shown === 'both'
    || (wire.slot.shown === 'first' && side === wire.slot.firstSide);
  const picks = box.querySelector('.picks');
  picks.replaceChildren(...Array.from({ length: perSide() }, (_, pos) => {
    const id = (wire.slot[side] || [])[pos] || '';
    const b = document.createElement('button');
    b.className = `pick${id ? '' : ' empty'}${revealed && id ? ' revealed' : ''}`;
    b.textContent = id ? nameOf(show, id) : 'Tap to pick';
    b.onclick = () => openPicker(side, pos);
    return b;
  }));
}

function render() {
  if (!show || !wire) return;
  $('slot-label').textContent = slotLabel(wire) + (wire.rehearsal ? '  ·  REHEARSAL' : '');

  const sync = syncLabel(wire.sync);
  $('sync').textContent = sync.text;
  $('sync').dataset.tone = sync.tone;

  const problems = describeProblems(wire.slot.problems, show);
  const box = $('problems');
  box.hidden = problems.length === 0;
  box.innerHTML = `<ul>${problems.map((p) => `<li>${p}</li>`).join('')}</ul>`;

  renderSide('intl');
  renderSide('usa');

  const nextIds = [...(wire.next.intl || []), ...(wire.next.usa || [])].filter(Boolean);
  $('next-summary').textContent = nextIds.length
    ? nextIds.map((id) => nameOf(show, id)).join(' · ')
    : 'Last match of the day';

  $('reveal').textContent = wire.slot.shown === 'none' ? 'Reveal first side'
    : wire.slot.shown === 'first' ? 'Reveal second side' : 'Both revealed';
  $('reveal').disabled = wire.slot.shown === 'both';
  $('day1').disabled = wire.day === 1;
  $('day2').disabled = wire.day === 2;
  $('slideshow').textContent = wire.mode === 'slideshow' ? 'Back to live' : 'Slideshow';
}

$('reveal').onclick = () => send({ name: 'reveal' });
$('next').onclick = () => send({ name: 'next' });
$('undo').onclick = () => send({ name: 'undo' });
$('day1').onclick = () => send({ name: 'setDay', day: 1 });
$('day2').onclick = () => send({ name: 'setDay', day: 2 });
$('jump').onclick = () => openJumper();
$('refresh').onclick = () => send({ name: 'refreshFromAws' });
$('slideshow').onclick = () => send({ name: 'setMode', mode: wire.mode === 'slideshow' ? 'live' : 'slideshow' });
$('toggle-first').onclick = () => send({ name: 'setFirstSide', side: wire.slot.firstSide === 'intl' ? 'usa' : 'intl' });
$('picker-cancel').onclick = () => $('picker').close();
$('jumper-cancel').onclick = () => $('jumper').close();

async function boot() {
  show = await (await fetch('/api/show')).json();
  show.byId = Object.fromEntries(show.players.map((p) => [p.id, p]));
  wire = await (await fetch('/api/state')).json();
  render();

  const events = new EventSource('/events');
  events.addEventListener('state', (e) => { wire = JSON.parse(e.data); render(); });
  // Safari suspends a backgrounded tab. On reconnect, re-pull the whole state
  // instead of assuming nothing was missed while the iPad was asleep.
  events.onerror = () => {
    setTimeout(async () => {
      try { wire = await (await fetch('/api/state')).json(); render(); } catch { /* retry on next error */ }
    }, 1500);
  };
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible') return;
    try { wire = await (await fetch('/api/state')).json(); render(); } catch { /* the SSE retry will catch it */ }
  });
}

boot();
```

- [ ] **Step 8: Walk it on the iPad**

```bash
npm run party:start -- --no-sync
```

Scan the QR from the terminal with the iPad. Then, on the iPad: pick two USA players, press **Reveal first side**, watch the laptop's `/stage`; press **Reveal second side**; press **Next match**. Assign the same player to both USA slots and check the red problem bar names him. Press **Undo** and watch it reverse. Lock the iPad, wait thirty seconds, unlock, and confirm the console repaints with current state rather than a stale screen.

- [ ] **Step 9: Commit**

```bash
git add party/public/console.mjs party/public/operator.html party/public/operator.css party/public/operator.js party/test/console.test.mjs
git commit -m "$(cat <<'EOF'
feat(party): the operator console

Two panes, big targets, undo kept away from reveal. Duplicate players are named
in plain English rather than rejected, and the sync indicator says whether AWS
has what is on screen and how stale it is if not.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013XspHF9gopSSxm6j3nkjGb
EOF
)"
```

---

### Task 12: Rehearsal mode, the runbook, and the night-of scripts

**Files:**
- Create: `party/rehearse.mjs`, `party/README.md`, `party/test/rehearse.test.mjs`

**Interfaces:**
- Consumes: `createHub` (Task 9), `POST /api/command`.
- Produces:
  - `rehearsalPlan(show) -> Command[]` — the full command sequence for a complete run-through: assign both sides of all 39 matches from the roster, reveal, reveal, next.
  - `runRehearsal({ hub, baseUrl, plan, pace, onStep, fetchImpl }) -> Promise<number>` — resolves to the number of commands sent.

**Rehearsal is a separate process with a separate state file and the network switched off.** `party/hub.mjs --rehearsal` already points at `party/state.rehearsal.json` and sets `enableSync: false` (Task 9's `parseArgs`). `party/rehearse.mjs` starts that hub and then drives it. The two things that must be true, and are tested: **a rehearsal never writes `party/state.json`**, and **a rehearsal never reaches AWS**. Running the show twice into the live tables the week before would be the worst kind of avoidable mess.

`pace` is seconds per step, default 2. The whole run is about four minutes at that pace, or set `--pace 11` to sit through it at something like real speed.

- [ ] **Step 1: Write the failing test**

Create `party/test/rehearse.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { rehearsalPlan, runRehearsal } from '../rehearse.mjs';
import { indexShow } from '../build/build-show.mjs';

function makeShow() {
  const players = [];
  for (let i = 1; i <= 26; i++) players.push({ id: `player-intl-${i}`, team: 'international', name: `I${i}` });
  for (let i = 1; i <= 26; i++) players.push({ id: `player-usa-${i}`, team: 'usa', name: `U${i}` });
  const day1 = [];
  for (let i = 1; i <= 13; i++) day1.push({ index: i, intl: [`player-intl-${i * 2 - 1}`, `player-intl-${i * 2}`], usa: ['', ''] });
  const day2 = [];
  for (let i = 1; i <= 26; i++) day2.push({ index: i, intl: [`player-intl-${i}`], usa: [''] });
  return indexShow({ built: 'now', players, days: { 1: day1, 2: day2 } });
}
const show = makeShow();

test('the plan walks both days end to end', () => {
  const plan = rehearsalPlan(show);
  assert.equal(plan[0].name, 'setDay');
  assert.equal(plan[0].day, 1);
  assert.equal(plan.filter((c) => c.name === 'next').length, 39);
  assert.equal(plan.filter((c) => c.name === 'reveal').length, 78);
  assert.ok(plan.some((c) => c.name === 'setDay' && c.day === 2));
  assert.equal(plan.at(-1).name, 'setMode');
  assert.equal(plan.at(-1).mode, 'slideshow');
});

test('both sides get filled, from the right teams', () => {
  const assigns = rehearsalPlan(show).filter((c) => c.name === 'assign');
  assert.equal(assigns.length, 78);
  for (const a of assigns) {
    const want = a.side === 'intl' ? 'international' : 'usa';
    assert.ok(a.players.every((id) => show.byId[id].team === want), `${a.side} got the wrong team`);
  }
});

test('no player is used twice on a day', () => {
  const plan = rehearsalPlan(show);
  let day = 1;
  const used = { 1: new Set(), 2: new Set() };
  for (const c of plan) {
    if (c.name === 'setDay') day = c.day;
    if (c.name !== 'assign') continue;
    for (const id of c.players) {
      assert.equal(used[day].has(id), false, `${id} used twice on day ${day}`);
      used[day].add(id);
    }
  }
});

test('the driver sends every command and reports the count', async () => {
  const sent = [];
  const fetchImpl = async (url, init) => {
    sent.push(JSON.parse(init.body));
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  const plan = [{ name: 'reveal' }, { name: 'next' }];
  const n = await runRehearsal({ baseUrl: 'http://127.0.0.1:1', plan, pace: 0, fetchImpl });
  assert.equal(n, 2);
  assert.deepEqual(sent, plan);
});

test('the driver keeps going when the hub rejects one command', async () => {
  let call = 0;
  const fetchImpl = async () => {
    call += 1;
    return call === 1
      ? { ok: false, status: 400, json: async () => ({ ok: false, error: 'no slot 99' }) }
      : { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  const n = await runRehearsal({
    baseUrl: 'http://127.0.0.1:1', plan: [{ name: 'goto', index: 99 }, { name: 'reveal' }],
    pace: 0, fetchImpl,
  });
  assert.equal(n, 2);
});

test('a rehearsal leaves the live state file alone and never reaches AWS', async () => {
  const { createHub } = await import('../hub.mjs');
  const { mkdtempSync, writeFileSync, mkdirSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');

  const dir = mkdtempSync(join(tmpdir(), 'rehearse-'));
  mkdirSync(join(dir, 'cards'));
  mkdirSync(join(dir, 'public'));
  writeFileSync(join(dir, 'public', 'stage.html'), 'x');
  writeFileSync(join(dir, 'public', 'operator.html'), 'x');
  writeFileSync(join(dir, 'show.json'), JSON.stringify(show));

  let touchedNetwork = false;
  const hub = await createHub({
    showPath: join(dir, 'show.json'),
    statePath: join(dir, 'state.rehearsal.json'),
    cardsDir: join(dir, 'cards'), publicDir: join(dir, 'public'),
    port: 0, enableSync: false, rehearsal: true, quiet: true,
    fetchImpl: async () => { touchedNetwork = true; throw new Error('must not be called'); },
  });
  const base = `http://127.0.0.1:${hub.server.address().port}`;
  try {
    await runRehearsal({ baseUrl: base, plan: rehearsalPlan(show).slice(0, 6), pace: 0 });
    const state = await (await fetch(`${base}/api/state`)).json();
    assert.equal(state.rehearsal, true);
    assert.equal(touchedNetwork, false, 'rehearsal must not reach AWS');
    assert.equal(existsSync(join(dir, 'state.json')), false, 'rehearsal must not write the live state file');
    assert.equal(existsSync(join(dir, 'state.rehearsal.json')), true);
  } finally { await hub.stop(); }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test 'party/test/*.test.mjs'`
Expected: FAIL — `Cannot find module '../rehearse.mjs'`.

- [ ] **Step 3: Implement the rehearsal driver**

Create `party/rehearse.mjs`:

```js
#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHub, DEFAULT_PORT } from './hub.mjs';
import { indexShow } from './build/build-show.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

export function rehearsalPlan(show) {
  const plan = [];
  const intl = show.players.filter((p) => p.team === 'international').map((p) => p.id);
  const usa = show.players.filter((p) => p.team === 'usa').map((p) => p.id);

  for (const day of [1, 2]) {
    plan.push({ name: 'setDay', day });
    const slots = show.days[String(day)];
    const n = day === 1 ? 2 : 1;
    slots.forEach((slot, i) => {
      plan.push({ name: 'goto', index: i });
      plan.push({ name: 'assign', side: 'intl', players: intl.slice(i * n, i * n + n) });
      plan.push({ name: 'reveal' });
      plan.push({ name: 'assign', side: 'usa', players: usa.slice(i * n, i * n + n) });
      plan.push({ name: 'reveal' });
      plan.push({ name: 'next' });
    });
  }
  plan.push({ name: 'setMode', mode: 'slideshow' });
  return plan;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function runRehearsal({
  baseUrl, plan, pace = 2, onStep = () => {}, fetchImpl = fetch,
}) {
  let sent = 0;
  for (const [i, command] of plan.entries()) {
    let outcome = 'ok';
    try {
      const res = await fetchImpl(`${baseUrl}/api/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(command),
      });
      const body = await res.json();
      if (!body.ok) outcome = body.error;
    } catch (e) {
      outcome = e.message;
    }
    sent += 1;
    onStep(i + 1, plan.length, command, outcome);
    if (pace) await sleep(pace * 1000);
  }
  return sent;
}

function parseArgs(argv) {
  const args = { pace: 2, port: DEFAULT_PORT };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--pace') args.pace = Number(argv[++i]);
    else if (argv[i] === '--port') args.port = Number(argv[++i]);
  }
  return args;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const showPath = join(HERE, 'show.json');
  const show = indexShow(JSON.parse(readFileSync(showPath, 'utf8')));

  const hub = await createHub({
    showPath,
    statePath: join(HERE, 'state.rehearsal.json'),
    port: args.port,
    enableSync: false,
    rehearsal: true,
  });
  const base = `http://127.0.0.1:${hub.server.address().port}`;
  console.log(`\n  REHEARSAL. Nothing reaches AWS and party/state.json is untouched.`);
  console.log(`  Stage     ${base}/stage`);
  console.log(`  Operator  ${base}/operator`);
  console.log(`  Pace      ${args.pace}s per step\n`);
  console.log('  Open the stage, click once to start it, then press Enter here.');
  await new Promise((r) => process.stdin.once('data', r));

  const plan = rehearsalPlan(show);
  await runRehearsal({
    baseUrl: base, plan, pace: args.pace,
    onStep: (i, total, c, outcome) =>
      console.log(`  [${String(i).padStart(3)}/${total}] ${c.name}${outcome === 'ok' ? '' : `  !! ${outcome}`}`),
  });
  console.log('\n  Rehearsal complete. The stage is now in slideshow. Ctrl-C when you have seen enough.\n');
}
```

- [ ] **Step 4: Add the script and run it once**

In `package.json`, replace the `party:rehearse` entry from Task 1 with:

```json
    "party:rehearse": "node party/rehearse.mjs",
```

Run: `node --test 'party/test/*.test.mjs'`
Expected: PASS, 123 tests.

Then sit through one: `npm run party:rehearse -- --pace 3`

- [ ] **Step 5: Write the runbook**

Create `party/README.md`:

```markdown
# Pairings party app

Drives the big screen at the pairings party. Spec:
`docs/superpowers/specs/2026-10-09-pairings-party-interface-design.md`.

**22 October 2026, 19:00, Spanky's Shenanigans, 538 E Market St, Leesburg VA.**

## Nothing here is deployed, and it must stay that way

`party/show.json` is built from `contacts/player-details.json` and carries
hometowns and schools for players who asked not to appear on the website. It is
gitignored, along with `party/state*.json` and `party/cards/`. The repo is
public. Do not add `party/` to `.github/workflows/deploy.yml`, and do not run
`npm run deploy:manual`, which would sync the whole working directory to S3.

## Build

    npm run party:flags     # once, downloads the 11 flag PNGs
    npm run party:build     # show.json + a card for all 52 players

`party:build` only makes what is missing, so re-run it whenever a new photo
arrives. To give someone a bespoke card, add their nickname to
`party/build/card-keys.json`, drop `<nickname>-4x9.mp4` and `<nickname>-8x9.mp4`
into `party/cards/`, and rebuild.

## The night

    npm run party:preflight         # do this the day before, in the venue
    npm run party:start             # syncs to production
    npm run party:start -- --target staging
    npm run party:start -- --no-sync

The terminal prints a QR code. Point the iPad camera at it.

- Laptop drives the TV over HDMI and runs `/stage` full screen.
- iPad runs `/operator`.
- **The laptop is always its own console.** If the iPad dies, open `/operator`
  on the laptop and carry on from the same slot.

Fallbacks if the venue network will not carry it, in order: phone hotspot;
laptop-hosted network; laptop alone. Each is a step down, not a recovery
procedure, and the Bonjour address does not change between them.

## Before you leave the house

- iPad: **Auto-Lock to Never.** The wake-lock API needs HTTPS and the LAN is
  plain HTTP, so this cannot be done in code.
- Laptop: **sleep disabled, including on AC power.**
- Laptop: **Do Not Disturb on.** A notification banner landing on the TV
  mid-reveal is the cheapest avoidable embarrassment of the night.

## If something goes wrong

| What you see | What to do |
| --- | --- |
| A card will not play | It falls back to that player's flag card by itself. Carry on. |
| The hub died, the laptop slept | `npm run party:start` again. It resumes at the same slot. |
| A stage screen went black | It reconnects by itself. If not, reload the page. |
| The iPad cannot reach the console | Client isolation. Switch both devices to the phone hotspot. |
| The sync indicator says Offline | Ignore it. The show is local. It flushes when the network returns. |
| Wrong player revealed | Undo, or re-pick and reveal again. |
| Captain announced out of order | Jump to… |

## Rehearsal

    npm run party:rehearse -- --pace 3

Runs the whole show against the real manifest and the real video files, into
`party/state.rehearsal.json`, with the network switched off. It cannot touch
the live state or the AWS tables.
```

- [ ] **Step 6: Commit**

```bash
git add party/rehearse.mjs party/README.md party/test/rehearse.test.mjs package.json
git commit -m "$(cat <<'EOF'
feat(party): rehearsal mode and the night-of runbook

A rehearsal runs into its own state file with sync switched off, so sitting
through the show in the kitchen cannot write the live tables.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013XspHF9gopSSxm6j3nkjGb
EOF
)"
```

---

### Task 13: The roster push and the pre-flight check

**Files:**
- Create: `party/build/push-roster.mjs`, `party/build/preflight.mjs`, `party/test/preflight.test.mjs`

**Interfaces:**
- Consumes: `loadRoster` (Task 1), `validateCards`/`indexShow` (Task 4), `API_URLS`/`loadPassword`/`getPlayers`/`putPlayers`/`getPairings` (Task 8), `pickLanAddress`/`localHostName` (Task 9).
- Produces:
  - `toPlayerItems(roster) -> Item[]` — the 52 players in `icup-players`' shape
  - `rosterDiff(existing, incoming) -> { added, removed, changed }`
  - `preflightChecks({ partyDir, apiUrl, fetchImpl }) -> Promise<Check[]>` where `Check = { name, ok, detail }`

**Why a roster push is needed at all, and why it is dangerous.** The party app's sync writes pairings whose `player1_id` values must resolve against `icup-players`. That table still holds **last year's 48-player roster** — confirmed by `GET /players` on 11 October 2026: 24 USA and 24 International, with names like Norm Corkhill and Troy Hazzard who are not on the 2026 teams. Until it is replaced, every pairing the party pushes will render as blank names on the website.

`updatePlayers` **deletes every id not in the list it is given**. So this script replaces the roster wholesale. It is therefore: staging by default, prints the full diff first, and refuses to act without `--confirm` *and* the typed phrase. Run it once, well before the night, and check the website afterwards.

The item shape, taken from the live table: `{ id, team: 'USA'|'International', firstName, lastName, nickname: '', teeColor: 'Blue' }`. Names split on the **last** space, so "Yun Sang Bae" becomes `Yun Sang` / `Bae` rather than `Yun` / `Sang Bae`.

- [ ] **Step 1: Write the failing test**

Create `party/test/preflight.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toPlayerItems, rosterDiff } from '../build/push-roster.mjs';
import { preflightChecks } from '../build/preflight.mjs';
import { loadRoster } from '../build/roster.mjs';

test('player items match the live table shape', () => {
  const items = toPlayerItems([
    { id: 'player-usa-1', team: 'usa', name: 'John Altman' },
    { id: 'player-intl-14', team: 'international', name: 'Yun Sang Bae' },
  ]);
  assert.deepEqual(items[0], {
    id: 'player-usa-1', team: 'USA', firstName: 'John', lastName: 'Altman',
    nickname: '', teeColor: 'Blue',
  });
  assert.deepEqual(items[1], {
    id: 'player-intl-14', team: 'International', firstName: 'Yun Sang', lastName: 'Bae',
    nickname: '', teeColor: 'Blue',
  });
});

test('the real roster makes 52 items with unique ids', () => {
  const items = toPlayerItems(loadRoster('contacts/player-details.json'));
  assert.equal(items.length, 52);
  assert.equal(new Set(items.map((i) => i.id)).size, 52);
  assert.equal(items.filter((i) => i.team === 'USA').length, 26);
});

test('the diff names who goes and who arrives', () => {
  const existing = [
    { id: 'player-usa-1', firstName: 'John', lastName: 'Altman' },
    { id: 'player-usa-4', firstName: 'Norm', lastName: 'Corkhill' },
  ];
  const incoming = [
    { id: 'player-usa-1', firstName: 'John', lastName: 'Altman' },
    { id: 'player-usa-2', firstName: 'Frank', lastName: 'Ambrose' },
  ];
  const d = rosterDiff(existing, incoming);
  assert.deepEqual(d.added.map((p) => p.lastName), ['Ambrose']);
  assert.deepEqual(d.removed.map((p) => p.lastName), ['Corkhill']);
  assert.deepEqual(d.changed, []);
});

test('a renamed id shows as changed, not as added and removed', () => {
  const d = rosterDiff(
    [{ id: 'player-intl-15', firstName: 'Yunsang', lastName: 'Bae' }],
    [{ id: 'player-intl-15', firstName: 'Yun Sang', lastName: 'Bae' }],
  );
  assert.equal(d.changed.length, 1);
  assert.equal(d.added.length, 0);
  assert.equal(d.removed.length, 0);
});

test('preflight reports a missing show.json rather than throwing', async () => {
  const checks = await preflightChecks({ partyDir: '/nowhere', apiUrl: null });
  const manifest = checks.find((c) => c.name === 'show.json');
  assert.equal(manifest.ok, false);
  assert.match(manifest.detail, /party:build/);
});

test('preflight reports AWS reachability without ever printing the password', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ pairings: [] }) });
  const checks = await preflightChecks({ partyDir: '/nowhere', apiUrl: 'https://api.example/prod', fetchImpl });
  const aws = checks.find((c) => c.name === 'AWS reachable');
  assert.equal(aws.ok, true);
  assert.equal(JSON.stringify(checks).includes('password'), false);
});

test('preflight reports AWS being down as a failed check, not an exception', async () => {
  const fetchImpl = async () => { throw new Error('ENOTFOUND api.example'); };
  const checks = await preflightChecks({ partyDir: '/nowhere', apiUrl: 'https://api.example/prod', fetchImpl });
  assert.equal(checks.find((c) => c.name === 'AWS reachable').ok, false);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test 'party/test/*.test.mjs'`
Expected: FAIL — `Cannot find module '../build/push-roster.mjs'`.

- [ ] **Step 3: Implement the roster push**

Create `party/build/push-roster.mjs`:

```js
#!/usr/bin/env node
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { loadRoster } from './roster.mjs';
import { API_URLS, loadPassword, getPlayers, putPlayers } from '../lib/aws.mjs';

const TEAM_LABEL = { usa: 'USA', international: 'International' };

export function toPlayerItems(roster) {
  return roster.map((p) => {
    const parts = p.name.trim().split(/\s+/);
    const lastName = parts.pop();
    return {
      id: p.id,
      team: TEAM_LABEL[p.team],
      firstName: parts.join(' '),
      lastName,
      nickname: '',
      teeColor: 'Blue',
    };
  });
}

const label = (p) => `${p.firstName} ${p.lastName}`;

export function rosterDiff(existing, incoming) {
  const before = new Map(existing.map((p) => [p.id, p]));
  const after = new Map(incoming.map((p) => [p.id, p]));
  const added = incoming.filter((p) => !before.has(p.id));
  const removed = existing.filter((p) => !after.has(p.id));
  const changed = incoming.filter((p) => {
    const was = before.get(p.id);
    return was && label(was) !== label(p);
  }).map((p) => ({ ...p, was: label(before.get(p.id)) }));
  return { added, removed, changed };
}

function parseArgs(argv) {
  const args = { target: 'staging', confirm: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--target') args.target = argv[++i];
    else if (argv[i] === '--confirm') args.confirm = true;
  }
  return args;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const apiUrl = API_URLS[args.target];
  if (!apiUrl) throw new Error(`unknown target "${args.target}" - use prod or staging`);

  const incoming = toPlayerItems(loadRoster('contacts/player-details.json'));
  const existing = await getPlayers({ apiUrl });
  const d = rosterDiff(existing, incoming);

  console.log(`\n  Target: ${args.target}  (${apiUrl})`);
  console.log(`  icup-players currently holds ${existing.length}; this would leave ${incoming.length}.\n`);
  for (const p of d.removed) console.log(`   - REMOVE  ${p.id.padEnd(18)} ${label(p)}`);
  for (const p of d.added) console.log(`   + ADD     ${p.id.padEnd(18)} ${label(p)}`);
  for (const p of d.changed) console.log(`   ~ RENAME  ${p.id.padEnd(18)} ${p.was} -> ${label(p)}`);
  if (!d.added.length && !d.removed.length && !d.changed.length) {
    console.log('   (no change)\n');
    process.exit(0);
  }

  console.log('\n  updatePlayers DELETES every id not in the list above.');
  console.log('  Anything already referencing a removed id - old pairings, old results - will');
  console.log('  render as a blank name afterwards.\n');

  if (!args.confirm) {
    console.log('  Dry run. Re-run with --confirm to be asked for the phrase.\n');
    process.exit(0);
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const typed = await rl.question(`  Type REPLACE-ROSTER-${args.target.toUpperCase()} to proceed: `);
  rl.close();
  if (typed.trim() !== `REPLACE-ROSTER-${args.target.toUpperCase()}`) {
    console.log('\n  Not confirmed. Nothing was written.\n');
    process.exit(1);
  }

  await putPlayers({ apiUrl, password: loadPassword({ target: args.target }), players: incoming });
  const after = await getPlayers({ apiUrl });
  console.log(`\n  [ok] icup-players now holds ${after.length} players.\n`);
}
```

- [ ] **Step 4: Implement the pre-flight check**

Create `party/build/preflight.mjs`:

```js
#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { indexShow, validateCards } from './build-show.mjs';
import { API_URLS, getPairings } from '../lib/aws.mjs';
import { pickLanAddress, localHostName } from '../lib/net.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PARTY = resolve(HERE, '..');

export async function preflightChecks({
  partyDir = PARTY, apiUrl = API_URLS.prod, fetchImpl = fetch,
} = {}) {
  const checks = [];
  const showPath = join(partyDir, 'show.json');

  if (!existsSync(showPath)) {
    checks.push({ name: 'show.json', ok: false, detail: `missing at ${showPath} - run: npm run party:build` });
  } else {
    let show = null;
    try {
      show = indexShow(JSON.parse(readFileSync(showPath, 'utf8')));
      checks.push({ name: 'show.json', ok: true, detail: `${show.players.length} players, built ${show.built}` });
    } catch (e) {
      checks.push({ name: 'show.json', ok: false, detail: `unreadable: ${e.message}` });
    }
    if (show) {
      const problems = validateCards(show, partyDir);
      checks.push({
        name: 'cards',
        ok: problems.length === 0,
        detail: problems.length ? `${problems.length} problem(s):\n      ${problems.slice(0, 10).join('\n      ')}` : 'every card present and the right size',
      });
      const slots = show.days['1'].length + show.days['2'].length;
      checks.push({ name: 'running order', ok: slots === 39, detail: `${show.days['1'].length} team + ${show.days['2'].length} singles` });
    }
  }

  const lan = pickLanAddress(networkInterfaces());
  checks.push({
    name: 'LAN address',
    ok: Boolean(lan),
    detail: lan ? `${lan.iface} ${lan.address}` : 'no routable IPv4 - the iPad will not reach the console',
  });

  const host = localHostName();
  checks.push({
    name: 'Bonjour name',
    ok: Boolean(host),
    detail: host || 'scutil gave nothing; use the IP address instead',
  });

  if (apiUrl) {
    try {
      const pairings = await getPairings({ apiUrl, fetchImpl });
      checks.push({ name: 'AWS reachable', ok: true, detail: `${pairings.length} pairings in the table` });
    } catch (e) {
      checks.push({ name: 'AWS reachable', ok: false, detail: `${e.message} - the show is unaffected, sync will queue` });
    }
  }

  return checks;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const target = process.argv.includes('--target')
    ? process.argv[process.argv.indexOf('--target') + 1] : 'prod';
  const checks = await preflightChecks({ apiUrl: API_URLS[target] });

  console.log('');
  for (const c of checks) console.log(`  ${c.ok ? '[ok]' : '[!!]'} ${c.name.padEnd(16)} ${c.detail}`);

  console.log(`
  Do these by hand, here, in the venue, before the night:

  [ ] Open /operator on the iPad over the venue wifi. If it will not load,
      that is client isolation: switch both devices to the phone hotspot.
      It looks nothing like a network fault - both devices show full bars
      and working internet and still cannot see each other.
  [ ] Plug the laptop into the TV and run /stage full screen. Click it once.
  [ ] iPad: Auto-Lock to Never.
  [ ] Laptop: sleep disabled on AC power.
  [ ] Laptop: Do Not Disturb on.
`);

  if (checks.some((c) => !c.ok)) process.exit(1);
}
```

- [ ] **Step 5: Run the tests**

Run: `node --test 'party/test/*.test.mjs'`
Expected: PASS, 130 tests.

- [ ] **Step 6: Dry-run the roster push against staging**

```bash
node party/build/push-roster.mjs --target staging
```

Expected: a diff showing roughly 26 removals (last year's roster), 28 additions and a couple of renames, then `Dry run.` Nothing is written. **Do not pass `--confirm` without Erik saying so** — it replaces the live roster.

- [ ] **Step 7: Run the pre-flight**

Run: `npm run party:preflight`
Expected: `[ok]` on show.json, cards, running order, LAN address and Bonjour name, then the by-hand checklist.

- [ ] **Step 8: Commit**

```bash
git add party/build/push-roster.mjs party/build/preflight.mjs party/test/preflight.test.mjs
git commit -m "$(cat <<'EOF'
feat(party): roster push and the night-before pre-flight

icup-players still holds last year's 48, so pairings pushed from the party
would render as blank names. The push replaces it wholesale, which is
destructive, so it is staging by default, prints the diff, and needs a typed
phrase.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013XspHF9gopSSxm6j3nkjGb
EOF
)"
```

---

## Self-review

Run against the spec with fresh eyes after the plan was finished.

**Spec coverage.** Every section maps to a task: §4.1 hub → 9; §4.2 surfaces → 9, 10, 11; §4.3 networking and QR → 9; §4.3.1 pre-flight → 13; §4.4 sync → 7, 8, 11; §5.1 staging vs revealing → 5, 10, 11; §5.2 state shape → 5; §5.3/§5.4 the two day rhythms → 5, 10; §5.5 reveal order with fixed sides → 5, 10; §5.6 play once and hold → 10; §5.7 overrides → 5, 11; §5.8 slideshow → 5, 10; §6.1–§6.4 assets, generic cards, manifest, validation → 2, 3, 4; §7 failure modes → 6, 8, 9, 10, 12; §7.1 rehearsal → 12; §7.2 device settings → 12 (README) and 13 (pre-flight printout); §8 multi-screen → documented, no code, as specified.

**Three deliberate deviations, all recorded at the point of deviation:**

1. **Sync indicator.** §4.4 asks for "synced / *n* pending / offline". A snapshot flusher has no queue to count, so Task 11 shows the state plus the time of the last successful push instead.
2. **Flag cards for everyone.** §6.2 only requires them for players without a photo, but §7's "fall back to that player's generic card" needs one to exist for everybody. Task 4 builds all 104.
3. **`revealStep` is written through.** The spec says announced pairings go to AWS so the website stays right, and does not say what to do with the reveal state. Task 7 maps `shown` onto `revealStep`, so a match announced in the pub shows as revealed on the website. If that is not wanted, it is one constant in `party/lib/pairings.mjs`.

**One prerequisite the spec does not mention**, surfaced in Task 13: `icup-players` still holds the 2025 roster, so until it is replaced the pairings this app pushes will render as blank names on the website. It needs a decision from Erik, not just a script run, because `updatePlayers` deletes what it is not given.

**Review Focus coverage.** All five have a test in the task that owns the code: ranges → Task 9 `static.test.mjs`; comma and apostrophe through `drawtext` → Task 3 (renders a real card and probes it); unmapped country → Task 2; corrupt `state.json` → Task 6; duplicate players → Task 5 (detection) and Task 11 (named, not id'd, on screen).

**Type consistency.** `Player` gained `cards`, `fallback` and `generic` in Task 4 and is used with those names in 9, 10 and 11. `Wire` is produced by `project()` in Task 5 and consumed in 7, 10 and 11 with the same field names. `Slot.shown` is `'none' | 'first' | 'both'` throughout, and `firstSide`/`side` are `'intl' | 'usa'` everywhere, including the AWS mapping, which appends `-first`. The hub test fixture in Task 9 and the panel fixture in Task 10 both carry `fallback`, matching what Task 4 produces.

**Counts to expect:** 130 tests at the end, 13 commits, one per task.

---

## Execution handoff

**Plan complete and saved to `docs/superpowers/plans/2026-10-11-pairings-party-interface.md`. Please review the plan. Which execution approach would you prefer?**

- **Subagent-driven** - A fresh subagent implements each task and a fresh reviewer checks it before the next one starts, then a whole-branch review at the end. Most thorough; costs a fresh context per task and per review.
- **Native** - I implement every task myself in this session, the way this harness runs work, then one fresh reviewer on the most capable model checks the whole branch. Cheapest and fastest; no independent review until the end. Runs well with a mid-tier session model, since the plan carries the design.

**For this plan I recommend subagent-driven, because the thirteen tasks hand each other precise interfaces — `Wire`, `Player.fallback`, the exact AWS item shape — and a drift between two of them would not show up until the night, in front of a full room, which is the one failure this whole design exists to avoid. Does the plan capture what you want, and which approach should we use?**
