# 2026 Tournament Rollover — Design

**Date:** 2026-08-20
**Status:** Draft (awaiting user review)
**Owner:** Erik Wagner (@Maverik77)

## 1. Overview

Archive the completed 2025 tournament and reset the live site for the 2026 tournament (Oct 22–24, 2026; venue TBA; rosters TBA).

After this work:

- The live site (`www.lansdowne-international-cup.com`) is the 2026 tournament, with real dates, placeholder rosters, and a placeholder venue.
- The 2025 tournament is preserved read-only at `/history/2025/` (rosters, schedule, pairings, match results, news archive), and its hole-by-hole detail is reachable via the existing `tournament/results.html?year=2025` viewer.
- A new `/history/` hub lists all past tournaments and is linked from the top nav.
- Live DynamoDB tables (`icup-players-prod`, `icup-pairings-prod`, `icup-match-results-prod`, `icup-betslips-prod`, `icup-betting-config-prod`) are empty and ready for 2026.
- Betslips containing PII are moved to a private `icup-betslips-archive` table (not exposed to the frontend).

## 2. Scope

**In scope**

- 2025 data archival (players, pairings, match results, news, schedule metadata).
- Hole-by-hole 2025 results promoted from `icup-tournament-results-staging` (96 rows) to a new `icup-tournament-results-prod` table.
- 12 betslips moved from `icup-betslips-prod` to a new `icup-betslips-archive` table with a `year` attribute.
- Wipe of five live prod tables.
- New `/history/` hub + `/history/2025/` detail page.
- 2026 rollover edits to `index.html`, `js/admin.js`, `js/news.js`, `js/members.js`, `data/news.json`.
- Admin password bump `cup2025` → `cup2026`.
- Deploy workflow update to include `history/` folder.

**Out of scope (follow-ups)**

- Migrating the 2024 modal-based history (`js/historic-data*.js`) into the same `/history/2024/` pattern.
- Populating 2026 rosters (`us_team.md`, `international_team.md`, `icup-players-prod`) — happens later once known.
- Populating 2026 pairings, Day 1 tee times, betting config — happens closer to event date.
- Any Lambda or SAM template changes (both tables are created directly via SDK, matching the existing template schema).

## 3. Approach & rationale

**Chosen approach: static-snapshot archive + hybrid live** (rejected: adding a `year` attribute to every live table and modifying all Lambdas; rejected: per-year DynamoDB table sets).

- Static JSON files under `data/archive/YYYY/` are the right level of durability for read-only past-year context. They are git-tracked, immutable, and cheap to serve with the existing CloudFront cache setup.
- The one system that is already year-aware (tournament-results DynamoDB table, with GSIs on `year`) gets used for its designed purpose (hole-by-hole viewer).
- Live tables are wiped rather than year-partitioned because there is no need to query prior years' live data.
- Betslips are moved (not deleted) because they represent real financial transactions worth preserving privately, but are not part of the public archive because they contain emails, phone numbers, and payment details.

## 4. Data model — where 2025 lives after rollover

### 4.1 Repo (git-tracked static JSON)

Location: `data/archive/2025/`. Served with the same `application/json` + `max-age=60` headers as `data/news.json`.

| File | Source | Shape |
|---|---|---|
| `players.json` | scan of `icup-players-prod` | array of 48 player objects (id, name, team, handicap, …) |
| `pairings.json` | scan of `icup-pairings-prod` | array of 36 match objects (18 team + 18 singles), `revealed: true` for all |
| `match-results.json` | scan of `icup-match-results-prod` | array of 36 result objects (matchId, winner, finalScore, per-match summary) |
| `news.json` | copy of `data/news.json` at rollover | untouched array of 2025 news items |
| `schedule.json` | hand-crafted from `index.html:290-395` | `{ year: 2025, dates: "October 16-18, 2025", venue: { name, address, hours }, days: [{ date, label, tees }] }` |

Manifest: `data/archive/index.json` = `{ years: [{ year, dates, venue, winner, finalScore }] }`. Consumed by the hub page. One entry per archived year, newest first.

### 4.2 DynamoDB — new tables

**`icup-tournament-results-prod`** — schema matches `pairings-infrastructure.yaml:184-221` exactly:

- PK: `yearMatchId` (S), SK: `dataType` (S)
- GSI `year-day-index`: HASH `year` (N), RANGE `dayMatchNumber` (S), projection ALL
- GSI `player-index`: HASH `playerName` (S), RANGE `yearMatchId` (S), projection ALL
- Billing: `PAY_PER_REQUEST`

Populated with 96 rows copied from `icup-tournament-results-staging` (all carry `year=2025` already).

**`icup-betslips-archive`** — mirrors `icup-betslips-prod`:

- PK: `betslipId` (S)
- Billing: `PAY_PER_REQUEST`

Populated with 12 rows copied from `icup-betslips-prod`, each with a `year: 2025` attribute added.

### 4.3 DynamoDB — live tables (wiped after archive)

`icup-players-prod`, `icup-pairings-prod`, `icup-match-results-prod`, `icup-betslips-prod`, `icup-betting-config-prod` — scanned and batch-deleted. `icup-reveal-state-prod` is already empty; left alone.

## 5. Migration mechanics

Two Node.js scripts under a new `scripts/` directory, using the same `@aws-sdk/*` deps as the Lambdas. No new npm deps. Both run manually with `node scripts/…`.

### 5.1 `scripts/archive-2025.js` — non-destructive

1. **Precheck.** Assert `AWS_PROFILE` is `icup_website_user` (or the identity resolves to account `792782029232`); print `sts get-caller-identity` result; abort if wrong account. Assert each source table exists and matches expected item counts:
   - `icup-players-prod`: 48
   - `icup-pairings-prod`: 36
   - `icup-match-results-prod`: 36
   - `icup-betslips-prod`: 12
   - `icup-betting-config-prod`: 1
   - `icup-tournament-results-staging`: 96

   Abort loudly on mismatch (counts already verified at design time, so a mismatch means live state has drifted and the script needs a human look before proceeding).
2. **Create new tables** (idempotent — describe-table first; skip if exists). Schema per §4.2.
3. **Export static snapshots.** Scan `icup-players-prod`, `icup-pairings-prod`, `icup-match-results-prod`; write each to `data/archive/2025/{name}.json` (pretty-printed for git-diff readability). Copy `data/news.json` verbatim to `data/archive/2025/news.json`. The file `data/archive/2025/schedule.json` is authored by hand by the developer and committed to the branch BEFORE the archive script runs — the script only asserts it exists, it does not generate it (schedule content is copy from `index.html:290-395`, not derivable from DynamoDB). Write/update `data/archive/index.json` with the 2025 entry, computing `winner` and `finalScore` from `match-results.json` (majority of match winners → winning team; per-team match tally → final score string like "USA 20 – Intl 16").
4. **Promote hole-by-hole.** Scan `icup-tournament-results-staging` (96 rows), batch-write into `icup-tournament-results-prod`. Retry on `UnprocessedItems`.
5. **Copy betslips.** Scan `icup-betslips-prod`, add `year: 2025` to each item, batch-write into `icup-betslips-archive`.
6. **Verify.** Re-read all destinations, compare counts to sources, sample 3 rows per destination, print a report. Non-zero exit code if any check fails.

### 5.2 `scripts/wipe-live-tables-2026.js` — destructive

Requires typing `WIPE-2026` at an interactive `readline` prompt. No `-y` or `--force` flag.

1. **Sanity check.** Same account guard as §5.1. Verify `data/archive/2025/*.json` all exist and are non-empty. Verify `icup-tournament-results-prod` has ≥96 items and `icup-betslips-archive` has ≥12 items.
2. **Wipe.** For each of `icup-players-prod`, `icup-pairings-prod`, `icup-match-results-prod`, `icup-betslips-prod`, `icup-betting-config-prod`: scan for keys, batch-delete in chunks of 25 (DynamoDB batch limit), retry on `UnprocessedItems`.
3. **Report.** Print pre-count and post-count for each table.

### 5.3 `scripts/restore-from-archive-2025.js` — rollback

Reads `data/archive/2025/*.json` and batch-writes rows back into the live tables. Same account guard + interactive `RESTORE-2025` confirmation. Written alongside the other two scripts and code-reviewed BEFORE step 7 (wipe) runs — treated as insurance, not routinely exercised. (A full live-fire test against staging would require populating and depopulating staging tables, which is more risk than the coverage is worth.)

### 5.4 Why not `sam deploy` for the new tables?

Deploying the SAM template with `Environment=prod` would create the tables but also redeploy 28 Lambdas — larger blast radius than needed. Creating the two tables via SDK, matching the template schema exactly, is safer here. If the SAM template is deployed later for unrelated reasons, `AWS::DynamoDB::Table` with a matching name is a no-op unless the schema drifts (it won't).

## 6. Frontend

### 6.1 New pages

- **`history/index.html`** — hub. Grid of year cards. Each card shows year, dates, venue, winning team, final score. Loads `js/history-hub.js`, which fetches `data/archive/index.json` and renders. 2025 card links to `/history/2025/`. 2024 card keeps its existing modal (`window.show2024Results`) until the 2024 archive migration follow-up. Older cards (2023/2022/2021) stay inert like they are today.

- **`history/2025/index.html`** — detail. Sections in order:
  1. Header — year, dates, venue, headline result
  2. Rosters — USA (24) + International (24) from `players.json`
  3. Schedule — from `schedule.json`
  4. Pairings + results — 18 team matches + 18 singles from `pairings.json`, joined with `match-results.json` on match id; each row shows players, winner, final score
  5. CTA: "See hole-by-hole scoring →" links to `../tournament/results.html?year=2025`
  6. News archive — collapsible list from `news.json`

  Loads `js/history-year.js`.

### 6.2 New JS

- **`js/history-hub.js`** — fetches `data/archive/index.json`, renders card grid, wires clicks to per-year detail pages.
- **`js/history-year.js`** — parses year from `location.pathname` (matches `/history/(\d{4})/`); parallel-fetches `data/archive/<year>/{players,pairings,match-results,news,schedule}.json`; renders each section. Generic — any future year that gets a `data/archive/<year>/` folder plus a manifest entry works with no new JS.

### 6.3 New CSS

- **`css/history.css`** — archive-specific card + table styles. Reuses CSS custom properties defined in `css/styles.css`.

### 6.4 Home page wiring

- Top nav in `index.html` gets a "History" link → `/history/`.
- Existing History section on `index.html` (~line 400) is simplified: 2025 card links to `/history/2025/`, 2024 card keeps its modal (for now), older cards stay inert, footer of the section gets a "View full archive →" link.

### 6.5 Deploy workflow

`.github/workflows/deploy.yml` — add `cp -r history build/` to both the `deploy-production` and `deploy-staging` build steps (the `data/` folder is already copied).

## 7. Live 2026 site edits

### 7.1 `index.html`

| Line(s) | Change |
|---|---|
| 6, 8 | Meta description + `<title>` → "International Cup 2026 - Golf at its best" |
| 53 | Hero `<h1>` → "International Cup 2026" |
| 91 | About: "5th year" → "6th year" |
| 210–284 | USA + International roster blocks replaced with a single "Roster being finalized — check back soon" placeholder card per team, styled to match existing roster card sizing |
| 290–395 | Schedule: date chips → Oct 22 / Oct 23 / Oct 24; venue block → "Venue: To be announced" (address/hours removed); tee-time range text → "Tee times posted closer to the event"; remove Norman-Course-specific copy |
| 501 | Footer → "© 2026 International Cup" |
| 815 | Day 1 tee-times toggle button + panel removed from the DOM entirely (not CSS-hidden — cleaner, no dead fetch). Re-added when the 2026 Day 1 tee sheet is available. Day 2 dynamic placeholder stays as-is. |

Top-nav "History" link added (see §6.4).

### 7.2 `js/admin.js`

- Line 6: `adminPassword: 'cup2025'` → `'cup2026'`.
- Lines 235–238: bootstrap news item rewritten to "International Cup 2026 — save the date: October 22-24, 2026. Venue and rosters coming soon."

### 7.3 `js/news.js`

- Lines 41–44: identical fallback news item — same rewrite as §7.2.

### 7.4 `js/members.js`

- Lines 83–92, 337, 346: mock dashboard dates and activity feed strings bumped to 2026 references. Same shape, fresh strings.

### 7.5 `data/news.json`

- After being copied to `data/archive/2025/news.json` by the archive script, replaced in place with a single "welcome to 2026" post matching the text in §7.2.

### 7.6 What deliberately does not change

- Lambda code (no changes needed).
- SAM template / API Gateway / Cognito / SES.
- Betting/pairings admin surfaces — betting stays naturally disabled until pairings exist (per commit `ab3b277` — TBD players block bet buttons).
- Tournament-results viewer (`tournament/results.html`) — no changes; already year-aware.

## 8. Order of operations

1. Create branch `feature/2026-rollover` off `staging`.
2. On the branch: write all three scripts (`archive-2025.js`, `wipe-live-tables-2026.js`, `restore-from-archive-2025.js`) plus `scripts/package.json` (see §11); hand-author `data/archive/2025/schedule.json`; write `history/` pages + JS + CSS; make live-site edits per §7 EXCEPT do not modify `data/news.json` yet.
3. `aws sso login --profile default`; verify `aws --profile icup_website_user sts get-caller-identity` returns account `792782029232`.
4. Run `node scripts/archive-2025.js` against prod. Non-destructive. Commit generated `data/archive/2025/*.json` + `data/archive/index.json` to the branch.
5. Push branch → GitHub Actions deploys to `staging.lansdowne-international-cup.com`. Manual verification: hub renders, detail page renders, deep results viewer works, home page shows 2026 with placeholders. Verify with browser dev tools (no console errors, JSON fetches succeed).
6. **Explicit user go/no-go** before anything destructive.
7. Run `node scripts/wipe-live-tables-2026.js` against prod. Prompt requires `WIPE-2026`. Prints before/after counts.
8. Reset `data/news.json` to the single welcome post; commit.
9. Merge branch → `staging`. Verify staging end-to-end.
10. Merge `staging` → `main`. Production deploys via GitHub Actions.
11. Post-deploy walk of the prod URL: home is 2026, `/history/` shows 2025 card, `/history/2025/` renders, deep results viewer works.

## 9. Rollback

| Failure point | Reversal |
|---|---|
| Before step 7 (wipe) | Revert branch; `aws dynamodb delete-table` on the two new tables. Zero data lost. |
| After step 7 but before step 10 | All wiped rows are preserved in `data/archive/2025/*.json`. Run `node scripts/restore-from-archive-2025.js` against prod (tested first against staging). |
| After step 10 (prod live) | Same restore script + `git revert` on frontend commits + push to `main` to redeploy. |

## 10. Testing / verification

### 10.1 Script verification

- `archive-2025.js` prints a self-check report at the end (counts match, samples printed). Non-zero exit on any mismatch.
- `wipe-live-tables-2026.js` prints before/after counts. Post-counts must be 0 for every wiped table.
- `restore-from-archive-2025.js` is dry-run tested against staging tables (temporarily populated for the test) before the wipe runs against prod.

### 10.2 Staging browser walk

- `https://staging.lansdowne-international-cup.com/` — home shows "2026", Oct 22–24 dates, placeholder rosters + venue.
- `.../history/` — hub loads, 2025 card visible and clickable.
- `.../history/2025/` — every section renders; sample players and pairings match what's in `data/archive/2025/*.json`.
- `.../tournament/results.html?year=2025` — hole-by-hole viewer loads and shows data for 2025.
- Dev-tools console — no errors, no failed fetches.
- Nav "History" link — routes correctly.

### 10.3 Prod post-deploy walk

Same as §10.2 against `www.lansdowne-international-cup.com`.

## 11. Prerequisites

- SSO session active for `personal-admin` (account `792782029232`).
- `icup_website_user` profile configured for SSO (already done — this session).
- `icup-tournament-results-staging` still has 96 rows (verified: it does).
- Local Node.js ≥ 18.
- `scripts/` gets its own `package.json` with the three SDK deps it needs: `@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`, `@aws-sdk/credential-providers`. `cd scripts && npm install` before running the scripts. Kept separate from `lambda/package.json` so scripts and Lambda deps evolve independently.

## 12. Success criteria

- Home page shows 2026 tournament with Oct 22–24 dates, placeholder rosters, placeholder venue. No 2025 content anywhere on `index.html`.
- `/history/` hub reachable from top nav; 2025 card links to detail page.
- `/history/2025/` renders rosters (48 players), schedule, pairings (36 matches with winners), news archive, and CTA to deep results.
- `/tournament/results.html?year=2025` shows hole-by-hole data.
- Live DynamoDB tables (`players`, `pairings`, `match-results`, `betslips`, `betting-config`) are empty on prod.
- `icup-tournament-results-prod` exists and has 96 rows.
- `icup-betslips-archive` exists and has 12 rows with `year=2025`.
- `js/admin.js` accepts `cup2026` and rejects `cup2025`.

## 13. Follow-ups (not this task)

- Migrate 2024 modal-based history into `/history/2024/` using the same static-JSON pattern; retire `js/historic-data*.js`.
- Populate 2026 rosters into `us_team.md`, `international_team.md`, and `icup-players-prod` when known.
- Publish 2026 venue when booked (edit `index.html` schedule block).
- Publish 2026 pairings and Day 1 tee times closer to the event.
- Consider a `data/archive/README.md` documenting the archive shape for future maintainers.
