# 2026 Availability Form — Design

**Date:** 2026-08-20
**Status:** Draft (awaiting user review)
**Owner:** Erik Wagner (@Maverik77)

## 1. Overview

Ship a public RSVP form for the 2026 International Cup tournament (Oct 22–24). Anyone can visit the page, enter name + email, indicate whether they're attending, and if attending, which of the three event days they're coming to. Submissions are stored in DynamoDB, emailed to a 3-person admin list, and echoed back to the submitter as confirmation. Admins see a table of all submissions on a password-gated dashboard with CSV export.

This is the first new feature for 2026 (per the rollover follow-up list) — the roster pipeline that eventually feeds `pairings/admin.html`.

## 2. Scope

**In scope**
- Public form page at `/availability/` (no login required).
- Two new Lambda functions: `submitAvailability` (public POST) and `getAvailability` (admin-gated GET).
- New DynamoDB table `icup-availability-2026-prod` (email as PK, upsert-in-place on re-submits).
- SES notification email to a 3-person admin list on every submission (subject-prefixed `UPDATE:` for re-submits).
- SES confirmation email to the submitter.
- Admin dashboard at `/admin/availability.html` (password-gated with the current admin secret), with table view + client-side CSV export + filter chips.
- Nav link ("RSVP") on the home page top nav.
- Menu entry for the new admin surface added to `/admin/index.html`.
- One-shot setup script (`scripts/setup-availability-2026.js`) that creates the DynamoDB table, IAM role, Lambdas, and API Gateway wiring via AWS SDK. Idempotent.

**Out of scope (deliberately)**
- Staging environment for this feature. Testing happens on prod with disposable email addresses; if staging is later wanted, duplicate the resources with `-staging` suffix.
- Deadline / cutoff (form accepts submissions indefinitely).
- Auth (Cognito login) or roster-matching gate — public form + light SES email trail is enough for a ~50-person audience.
- Rate-limit or honeypot beyond default API Gateway behavior.
- Reminder emails to non-responders.
- Reconciling the growing SAM-drift list (Task-11 orphan tables + the new resources from this feature).
- Multi-year table consolidation.

## 3. Approach & rationale

**Chosen approach: extend the existing `PairingsApi` REST API with two new routes, backed by two new Lambdas and one new DynamoDB table, all created directly via AWS CLI/SDK (bypassing SAM).** (Rejected: form-service pass-through, e.g. Formspree — no admin dashboard. Rejected: `sam deploy` — requires solving the Task-11 orphan-tables ownership conflict first, blocking the feature on unrelated cleanup.)

- Same shape as the existing `createBetslip` → email → `getBetslips` admin flow. No new patterns to invent.
- Bypassing SAM keeps the feature unblocked; the drift is real but non-blocking. Cost: adds two more resources (Lambdas + API routes) plus one table to the future SAM reconciliation work.
- Email-as-DDB-PK because the audience is small, updates are common (people change their mind), and the current state matters more than an audit trail. `submissionCount` gives a coarse audit trail without a GSI.

## 4. Data model

**Table: `icup-availability-2026-prod`**

- **PK:** `email` (String) — lowercased + trimmed by the Lambda before every write. Upsert semantics: repeat submits overwrite in place.
- **Attributes** (all set on every write):
  - `name` (String)
  - `attending` (Boolean) — top-level Yes/No
  - `pairingsParty` (Boolean) — Wed Oct 22 evening; forced `false` when `attending === false`
  - `day1` (Boolean) — Thu Oct 23 team matches; forced `false` when `attending === false`
  - `day2` (Boolean) — Fri Oct 24 singles; forced `false` when `attending === false`
  - `firstSubmittedAt` (String, ISO) — preserved across upserts
  - `updatedAt` (String, ISO) — bumped on every write
  - `submissionCount` (Number) — incremented on every write; `1` on first insert, `2+` on updates
  - `userAgent` (String, truncated to 200 chars) — light spam triage aid
- **Billing:** `PAY_PER_REQUEST`
- **No GSI.** Admin dashboard `Scan`s the whole table (dataset stays small; ~50 rows expected).
- **Year in the table name** matches the rollover pattern (`icup-players-prod`, `icup-pairings-prod`, etc.). Next year: fresh `icup-availability-2027-prod`.

## 5. API + Lambda code shape

Both new routes are added to the existing `PairingsApi` REST API (the one the frontend already uses). Frontend keeps its existing base-URL split (`isStaging ? staging-URL : prod-URL`); staging URL routes to the same prod Lambdas since staging Lambdas aren't stood up for this feature.

### 5.1 `POST /availability` — public, no auth

Lambda `icup-submit-availability` (Node.js 18, ~90 lines).

Request body (JSON):

```json
{
  "name": "Jane Doe",
  "email": "jane@example.com",
  "attending": true,
  "pairingsParty": true,
  "day1": true,
  "day2": false
}
```

Flow:

1. Validate: `name` non-empty (max 100 chars), `email` matches `^[^\s@]+@[^\s@]+\.[^\s@]+$` (max 200 chars), `attending` is boolean, day fields are booleans. 400 on any failure with `{ error: 'validation', field, message }`.
2. Normalize: `email.toLowerCase().trim()`, `name.trim()`.
3. Force `pairingsParty`/`day1`/`day2` to `false` if `attending === false`.
4. `GetItem` by email:
   - If exists: `submissionCount = existing.submissionCount + 1`, `firstSubmittedAt` preserved from existing.
   - Else: `submissionCount = 1`, `firstSubmittedAt = updatedAt = now`.
5. `PutItem` with the full record + `userAgent = (event.headers['user-agent'] || '').slice(0, 200)`.
6. Send two SES emails (see §7). Wrap in `try/catch` — email failure does NOT fail the submission (DDB write is authoritative).
7. Return `200 { ok: true, submissionCount, updated: submissionCount > 1 }`.

CORS: `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Headers: Content-Type`, matches existing `PairingsApi` config.

### 5.2 `GET /availability` — admin-gated

Lambda `icup-get-availability` (Node.js 18, ~30 lines).

Flow:

1. `ADMIN_PASSWORD` env var read at module load; throw at cold-start if missing (fail-safe, matches other admin Lambdas after commit `d9b8027`).
2. Header lookup tolerates casing: `event.headers['x-admin-password'] || event.headers['X-Admin-Password']`. API Gateway REST v1 preserves the client's casing; the double-check keeps it safe. Mismatch or missing → 401 `{ error: 'unauthorized' }`.
3. `Scan` the table.
4. Sort items by `updatedAt` desc.
5. Return `200 { items, count }`.

### 5.3 IAM role — `icup-availability-lambda-role`

Trust policy: Lambda service. Attached: `AWSLambdaBasicExecutionRole`. Inline policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AvailabilityTable",
      "Effect": "Allow",
      "Action": ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:Scan"],
      "Resource": "arn:aws:dynamodb:us-east-1:792782029232:table/icup-availability-2026-prod"
    },
    {
      "Sid": "SendMail",
      "Effect": "Allow",
      "Action": ["ses:SendEmail"],
      "Resource": "*"
    }
  ]
}
```

Both Lambdas share this role. The `getAvailability` Lambda doesn't actually need SES but the surface is trivial and the shared role simplifies management.

Env vars per Lambda:

- `submitAvailability`: `AVAILABILITY_TABLE=icup-availability-2026-prod`, `NOTIFY_EMAIL='erikwagner77@gmail.com,ash@cavlog.com,tim_pearce36@hotmail.com'`, `SENDER_EMAIL=noreply@lansdowne-international-cup.com`.
- `getAvailability`: `AVAILABILITY_TABLE=icup-availability-2026-prod`, `ADMIN_PASSWORD=<current-prod-secret>` (sourced from `~/.icup-admin-passwords/prod-2026-08-20.txt` at deploy time; never committed).

## 6. Frontend

### 6.1 Public form: `availability/index.html` + `js/availability.js`

Layout (styled with existing `css/styles.css` + a small `css/availability.css`):

```
🏌️ Are you playing the 2026 International Cup?
Oct 22–24 · Venue TBA · Let us know if you can make it.

Name  [__________________]
Email [__________________]

○ Yes, I'm in
○ Can't make it this year

  (revealed only when "Yes" is selected)
  Which parts? (check all that apply)
  ☑ Pairings party — Wed Oct 22 evening
  ☑ Day 1 team matches — Thu Oct 23
  ☑ Day 2 singles — Fri Oct 24

          [ Submit RSVP ]
```

JS behavior (IIFE, script-tag loaded, no ES modules — same pattern as the rest of `js/`):

- Radio-driven visibility toggle for the three checkboxes.
- Default: all three checked when "Yes" is picked.
- Client-side validation before submit (name non-empty, email regex).
- On submit: disable button, show spinner, POST to `/availability`.
- Success message: `"Thanks, {name}. You told us: attending Party + Day 1 + Day 2."` (or `"Thanks, {name} — updated your RSVP."` when `submissionCount > 1`; or `"Thanks, {name} — sorry you can't make it this year."` when `attending === false`).
- Failure: red banner + re-enable button; error message pulled from response body when available.
- One-page flow: no navigation on success. User can change their answer and re-submit; UI resets to the current record's values so it's clear what they just said.

**Nav wiring on `index.html`:**

Add `<a href="availability/" class="nav-link">RSVP</a>` to the top nav, placed after `Home / Teams / Schedule / History` and before `Archive`. (Only site-wide edit.)

### 6.2 Admin dashboard: `admin/availability.html` + `js/availability-admin.js`

Same password-modal pattern as `pairings/admin.html`, `betting/admin.html`, `tournament/admin.html` (each has its own admin JS; this follows suit).

On unlock:

- `fetch('/availability', { headers: { 'X-Admin-Password': storedPassword }})`
- Render table:

| Name | Email | Attending | Party | Day 1 | Day 2 | First RSVP | Last update | Count |
|---|---|---|---|---|---|---|---|---|

- Counts summary at top: `"{N} attending · {M} declined · {K} updated"`.
- Filter chips: `All | Attending | Declined | Updated (count>1)`.
- Sort: default `updatedAt desc`; click any column header to sort otherwise.
- **Export CSV** button: client-side wrap of the currently-filtered rows (Blob + `URL.createObjectURL` + download link; no separate endpoint).

**Admin menu wiring on `admin/index.html`:**

Add a fourth `admin-links` `<li>` after Tournament results:

```html
<li>
  <a href="./availability.html">
    <strong>Availability RSVPs</strong>
    <span>Review who's signed up for the 2026 tournament.</span>
  </a>
</li>
```

### 6.3 Cache-busting

New JS/CSS files this feature adds are cache-busted from day one (`?v=2026-08-20`) so future edits don't get held back by the 1-year Cache-Control the deploy workflow sets on JS/CSS.

## 7. Email

**Sender:** `noreply@lansdowne-international-cup.com` (already SES-verified; used by `sendBetslipConfirmation`).

**Recipients — admin notification:** `erikwagner77@gmail.com, ash@cavlog.com, tim_pearce36@hotmail.com`. Lambda splits the `NOTIFY_EMAIL` env var on comma, uses SES `SendEmail` with `ToAddresses = [SENDER_EMAIL]` (the sender goes on the To line to satisfy strict SMTP + reduce spam-filter suspicion) and the admin list in `BccAddresses`. Consequence: admins don't see each other's addresses in headers, and adding/removing recipients is a Lambda env-var change.

**Admin email:**

- **Subject:** `RSVP: {name} — coming ({parts})` OR `RSVP: {name} — declined` OR `RSVP UPDATE: {name} — coming ({parts})` (prefix `UPDATE:` when `submissionCount > 1`).
- `{parts}` = comma-joined selected day labels (e.g. `Party + Day 1 + Day 2`, or `Day 1 only`, or `Day 1 + Day 2 (skipping party)`).
- **Body (plaintext):**

  ```
  Name:      {name}
  Email:     {email}
  Attending: {Yes|No}

  Pairings party (Wed Oct 22):     {Yes|No}
  Day 1 team matches (Thu Oct 23): {Yes|No}
  Day 2 singles (Fri Oct 24):      {Yes|No}

  Submitted: {ISO timestamp} UTC
  Submission #{submissionCount} for this email{ (first) | (update)}.

  Admin dashboard: https://www.lansdowne-international-cup.com/admin/availability.html
  ```

**Submitter confirmation email:**

- **Subject:** `Your International Cup 2026 RSVP` (or `Your updated RSVP` when `submissionCount > 1`).
- **Body (plaintext):**

  ```
  Hi {name},

  Thanks for letting us know. Here's what we have on file:

    Attending:       {Yes|No}
    Pairings party:  {Yes|No}
    Day 1:           {Yes|No}
    Day 2:           {Yes|No}

  Change your mind? Just re-submit at
  https://www.lansdowne-international-cup.com/availability/

  Questions? Reply to this email.

  — International Cup 2026
  ```

**Failure semantics:** either SES call throws → log the error with request context, continue. The DDB write is authoritative; admin still sees the submission in the dashboard. No retry, no dead-letter queue for the MVP.

## 8. Deployment mechanics (bypass SAM)

Same "hand-crafted infra" pattern as Task 11's `icup-tournament-results-prod`.

### 8.1 Repo layout

```
lambda/
  submitAvailability/
    index.js
    package.json          (@aws-sdk/client-dynamodb, lib-dynamodb, client-ses)
  getAvailability/
    index.js
    package.json          (@aws-sdk/client-dynamodb, lib-dynamodb)
availability/
  index.html              (public form)
admin/
  availability.html       (admin dashboard)
js/
  availability.js         (form logic — IIFE)
  availability-admin.js   (dashboard logic — IIFE)
css/
  availability.css        (small — form + dashboard specifics)
scripts/
  setup-availability-2026.js  (one-shot orchestrator, ES module, uses AWS SDK)
```

`.github/workflows/deploy.yml`: add `cp -r availability build/` to both jobs (mirrors Task 8's `history/` and the later `tournament/` fix).

### 8.2 `scripts/setup-availability-2026.js`

ES-module Node.js script under the existing `scripts/` package. Reads the admin password from `~/.icup-admin-passwords/prod-2026-08-20.txt` (never committed, never printed).

Idempotent — each step describes-then-creates, so safe to re-run. Uses the `scripts/lib/aws.js` helpers (`getClients`, `assertAccount`) established in Task 1 of the rollover.

Phases:

1. **Precheck** — `assertAccount()`; verify prod password file exists and is readable.
2. **Create DynamoDB table** `icup-availability-2026-prod` if absent; wait until ACTIVE.
3. **Create IAM role** `icup-availability-lambda-role` if absent; attach `AWSLambdaBasicExecutionRole` managed policy; put the inline policy from §5.3.
4. **Package + upload Lambdas**
   - For each of `submitAvailability`, `getAvailability`: `npm install --production` in the Lambda dir, zip the directory, `CreateFunction` (or `UpdateFunctionCode` + `UpdateFunctionConfiguration` if exists). Wait for state = Active. Set env vars from §5.3.
5. **Wire API Gateway** — look up the REST API id via `aws cloudformation list-stack-resources --stack-name icup-pairings-prod --query "StackResourceSummaries[?ResourceType==\`AWS::ApiGateway::RestApi\`].PhysicalResourceId"` (the API is SAM-managed with an auto-generated name; querying the stack is the reliable lookup). Look up the root resource id via `get-resources`. Create `/availability` resource, attach POST/GET/OPTIONS methods, integrate to the two Lambdas via AWS_PROXY, add mock integration for OPTIONS (matches existing pattern), add `Lambda:InvokeFunction` permission for API Gateway on each Lambda, create a new deployment on the `prod` stage.
6. **Verify**: `Describe` each resource, print counts + ARNs. `curl` the endpoint with a health check payload.

Script is committed to the repo as an artifact of the setup, matching the rollover scripts pattern. It becomes dead code after the initial run, kept around for auditability.

### 8.3 SAM-drift note

This adds the following outside the `icup-pairings-prod` stack:

- 1 DynamoDB table (`icup-availability-2026-prod`)
- 2 Lambda functions (`icup-submit-availability`, `icup-get-availability`)
- 1 API Gateway resource + 3 methods
- 1 IAM role + inline policy

Combined with Task 11's `icup-tournament-results-prod` and `icup-betslips-archive`, the drift list is now: 3 tables + 2 Lambdas + 1 API path + 1 IAM role + 1 IAM user (`icup-website-deploy`). Reconciliation is a future task; not blocking this feature.

## 9. Order of operations

1. Branch `feature/availability-form` off `main`.
2. On branch, write all code (Lambdas, HTML, JS, CSS, setup script, workflow update). No AWS interaction yet.
3. SSO check (`aws sso login --profile default`).
4. Run `node scripts/setup-availability-2026.js` — creates all AWS resources against prod. Idempotent; safe to re-run.
5. `curl` the live endpoint with a fake submission — verify DDB row appears + 3 admin emails arrive + 1 confirmation email arrives.
6. Manual browser-check of the not-yet-deployed pages via local `python3 -m http.server 8000` — form loads, dashboard loads (against prod API), auth prompt works.
7. **Explicit user go/no-go.**
8. Merge feature branch → `staging`, push. Watch deploy. Verify staging URL renders the form + admin dashboard (they hit prod API).
9. Merge `staging` → `main`, push. Prod deploys.
10. Verify prod: submit a fake RSVP via the live form, confirm end-to-end. Delete test rows via `aws dynamodb delete-item`.
11. Delete the feature branch. Announce internally.

## 10. Rollback

| Failure point | Reversal |
|---|---|
| Setup script errors partway | Script is idempotent; re-run after fixing. Or invoke inverse commands: `delete-function`, `delete-role`, `delete-table`, remove API resource. |
| API routes wired but Lambda buggy | `aws lambda update-function-code --zip-file fileb://…`. No API redeploy needed. |
| Form ships to prod, breaks UX | `git revert` the frontend commits + push to `main`. API stays up (harmless — no traffic hits it). |
| Spam floods the table | Add wipe script (small addition), or `aws dynamodb delete-table` + recreate. Real submissions can be preserved via `aws dynamodb scan` + local JSON dump before wipe. |
| SES rejects an email | Non-blocking — DDB write succeeds; admin still sees the submission. Fix SES verification or address, next submission emails correctly. |
| Admin password rotated later | Update the `getAvailability` Lambda env var via `aws lambda update-function-configuration` (same pattern used to rotate the other admin Lambdas). |

## 11. Testing / verification

**Manual, no automated tests** (consistent with the rest of the site).

### 11.1 Backend (via `curl` before frontend deploys)

- `POST /availability` with a valid body → 200; DDB has the row; 3 admin emails + 1 confirmation received.
- Same POST with same email but different day selection → 200 with `updated: true, submissionCount: 2`; DDB row updated; admin email subject prefixed `UPDATE:`; `firstSubmittedAt` unchanged.
- POST with `attending: false, day1: true` → row has `day1: false` (server-side coercion).
- POST with missing `email` → 400 `{ error: 'validation', field: 'email', ... }`.
- POST with malformed email → 400.
- POST with 300-char name → 400.
- `GET /availability` with correct `X-Admin-Password` → 200 with items sorted `updatedAt desc`.
- `GET /availability` with wrong password → 401.

### 11.2 Frontend (browser, on staging then prod)

- Form loads; radio toggle reveals/hides day checkboxes.
- Client validation catches empty name + malformed email.
- Successful submit shows summary message; on-page state resets to the just-submitted values.
- Re-submit shows "updated" message.
- Admin dashboard: password prompt → wrong password shows error, right password loads the table.
- Filter chips work; column sort works; CSV export downloads a properly-formatted file.
- Console: no errors.

### 11.3 Post-launch cleanup

- Delete test rows via `aws dynamodb delete-item`.

## 12. Prerequisites

- SSO session active for `personal-admin` (account `792782029232`).
- `icup_website_user` profile configured for SSO (established in the first session; still active).
- Admin password file present at `~/.icup-admin-passwords/prod-2026-08-20.txt` (needed for the `getAvailability` Lambda env var).
- Local Node.js ≥ 18; `scripts/package.json` already lists the SDK deps needed.
- `zip` CLI available (macOS default).

## 13. Success criteria

- `https://www.lansdowne-international-cup.com/availability/` loads a working form.
- Submissions create/upsert rows in `icup-availability-2026-prod`.
- Every submission emails the 3-person admin list and the submitter.
- Admin dashboard at `.../admin/availability.html` requires the current admin password, loads all rows, exports CSV.
- "RSVP" appears in the top nav on the home page.
- New "Availability RSVPs" card appears on `admin/index.html`.
- Zero console errors on either page.

## 14. Follow-ups (not this task)

- Cutoff date for submissions.
- Reminder emails to non-responders.
- Staging environment for this feature.
- Reconcile the growing SAM drift list (3 tables + 2 Lambdas + 1 API path + 1 IAM role + 1 IAM user, now all outside the SAM stack).
- Multi-year table strategy (roll `icup-availability-2026-prod` → `-2027-prod` next year).
- Move `NOTIFY_EMAIL` to a distribution list address instead of a comma-separated env var, so adding/removing admins doesn't require a Lambda config update.
- Rate-limit / honeypot if spam becomes an issue.
