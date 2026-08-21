# 2026 Availability Form Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a public RSVP form for the 2026 tournament that stores submissions in DynamoDB, notifies a 3-person admin BCC list via SES, and exposes an admin dashboard with CSV export.

**Architecture:** Same shape as the existing `createBetslip → SES → getBetslips` flow. New public + admin Lambdas on the existing `PairingsApi` REST API; new DynamoDB table with email as PK (upsert on repeat submits); all backend resources created via a one-shot AWS CLI/SDK script (bypasses SAM to avoid the Task-11 orphan-tables ownership issue).

**Tech Stack:** Vanilla HTML/CSS/JS (no build), Node.js 18 Lambdas (`@aws-sdk/*` v3), DynamoDB (PAY_PER_REQUEST), API Gateway REST, SES, GitHub Actions for static-site deploy.

**Spec:** `docs/superpowers/specs/2026-08-20-availability-form-design.md` (commit `eafc941`)

## Global Constraints

- **AWS profile:** `icup_website_user` (SSO → account `792782029232`). Every script/CLI call guards on this.
- **Region:** `us-east-1`.
- **Node.js ≥ 18.**
- **Table name:** `icup-availability-2026-prod`. **Lambda names:** `icup-submit-availability`, `icup-get-availability`. **IAM role:** `icup-availability-lambda-role`.
- **Sender email:** `noreply@lansdowne-international-cup.com` (SES-verified). **Notify list:** `erikwagner77@gmail.com,ash@cavlog.com,tim_pearce36@hotmail.com`.
- **Admin password:** sourced at deploy time from `~/.icup-admin-passwords/prod-2026-08-20.txt`. Never committed. Never echoed to context by any script or tool call.
- **Lambda handlers:** CommonJS `require(...)` (matches every existing `lambda/*/index.js`).
- **Frontend JS in `js/*.js`:** IIFE pattern, script-tag loaded. No ES modules.
- **Setup script `scripts/setup-availability-2026.js`:** ES module (matches `scripts/lib/aws.js` and the rollover scripts). Uses `scripts/lib/aws.js` helpers.
- **No test framework** — verification is via `curl`, `aws dynamodb scan`, and browser walks.
- **Cache-busting:** every new JS/CSS asset ships with `?v=2026-08-20` from day one so future edits reach browsers without hard-refresh.
- **Commit hygiene:** normal commits (no `--amend`, no `--no-verify`). Every commit ends with `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>`.
- **Branch:** all work on `feature/availability-form` off `main`. Never push to `main` directly; merge via `staging`.
- **Idempotency:** `setup-availability-2026.js` must be safe to re-run (describe-then-create for every resource; skip if already exists).

---

## File Structure

**New files:**

| Path | Purpose |
|---|---|
| `lambda/submitAvailability/index.js` | Public POST handler: validate, upsert DDB, send admin BCC + submitter confirmation |
| `lambda/submitAvailability/package.json` | Deps: `@aws-sdk/client-dynamodb`, `lib-dynamodb`, `client-ses` |
| `lambda/getAvailability/index.js` | Admin-gated GET handler: password check, scan, sort |
| `lambda/getAvailability/package.json` | Deps: `@aws-sdk/client-dynamodb`, `lib-dynamodb` |
| `availability/index.html` | Public form page |
| `admin/availability.html` | Admin dashboard page |
| `js/availability.js` | Form logic (IIFE) |
| `js/availability-admin.js` | Dashboard logic (IIFE) |
| `css/availability.css` | Shared styles for form + dashboard |
| `scripts/setup-availability-2026.js` | One-shot orchestrator: creates table, role, Lambdas, API routes |

**Modified files:**

| Path | Change |
|---|---|
| `index.html` | Add `<a class="nav-link" href="availability/">RSVP</a>` to top nav |
| `admin/index.html` | Add fourth admin-links `<li>` for "Availability RSVPs" |
| `.github/workflows/deploy.yml` | Add `cp -r availability build/` block to both prod + staging jobs |

---

### Task 1: Branch + Lambda directories + package.json files

Set up the branch and empty Lambda directories with their dependency manifests so subsequent tasks can just fill in the handler code.

**Files:**
- Create: `lambda/submitAvailability/package.json`, `lambda/getAvailability/package.json`

**Interfaces:**
- Produces: two Lambda directories ready for `zip` packaging by later tasks

- [ ] **Step 1: Create the branch**

```bash
git fetch origin
git checkout main
git pull origin main --ff-only
git checkout -b feature/availability-form
```

Expected: branch created from `main` at commit `bc131b6` (or whatever `main` currently is).

- [ ] **Step 2: Create `lambda/submitAvailability/package.json`**

```json
{
  "name": "icup-submit-availability",
  "version": "1.0.0",
  "description": "Public RSVP form submission handler",
  "main": "index.js",
  "private": true,
  "dependencies": {
    "@aws-sdk/client-dynamodb": "^3.400.0",
    "@aws-sdk/lib-dynamodb": "^3.400.0",
    "@aws-sdk/client-ses": "^3.910.0"
  }
}
```

- [ ] **Step 3: Create `lambda/getAvailability/package.json`**

```json
{
  "name": "icup-get-availability",
  "version": "1.0.0",
  "description": "Admin-gated availability list handler",
  "main": "index.js",
  "private": true,
  "dependencies": {
    "@aws-sdk/client-dynamodb": "^3.400.0",
    "@aws-sdk/lib-dynamodb": "^3.400.0"
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add lambda/submitAvailability/package.json lambda/getAvailability/package.json
git commit -m "$(cat <<'EOF'
Scaffold availability Lambdas (package.json only)

Two new Lambda dirs for the 2026 availability RSVP feature. Handler
code lands in the next commits; this establishes the deps so setup
can package them without churn.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `lambda/submitAvailability/index.js`

The public POST handler. Validates the body, upserts to DynamoDB, sends two SES emails.

**Files:**
- Create: `lambda/submitAvailability/index.js`

**Interfaces:**
- Consumes: env vars `AVAILABILITY_TABLE`, `NOTIFY_EMAIL` (comma-separated), `SENDER_EMAIL`
- Produces: HTTP handler for `POST /availability`

- [ ] **Step 1: Write the handler**

Create `lambda/submitAvailability/index.js`:

```javascript
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');

const AVAILABILITY_TABLE = process.env.AVAILABILITY_TABLE;
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL;
const SENDER_EMAIL = process.env.SENDER_EMAIL;

if (!AVAILABILITY_TABLE) throw new Error('AVAILABILITY_TABLE env var is required');
if (!NOTIFY_EMAIL) throw new Error('NOTIFY_EMAIL env var is required');
if (!SENDER_EMAIL) throw new Error('SENDER_EMAIL env var is required');

const NOTIFY_LIST = NOTIFY_EMAIL.split(',').map((s) => s.trim()).filter(Boolean);
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ddb = new DynamoDBClient({ region: 'us-east-1' });
const doc = DynamoDBDocumentClient.from(ddb);
const ses = new SESClient({ region: 'us-east-1' });

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
};

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: CORS_HEADERS, body: '' };
    }

    let body;
    try {
        body = JSON.parse(event.body || '{}');
    } catch (e) {
        return respond(400, { error: 'validation', message: 'Body must be JSON.' });
    }

    const { name, email, attending, pairingsParty, day1, day2 } = body;

    if (typeof name !== 'string' || name.trim().length === 0 || name.length > 100) {
        return respond(400, { error: 'validation', field: 'name', message: 'Name is required (1–100 chars).' });
    }
    if (typeof email !== 'string' || email.length > 200 || !EMAIL_REGEX.test(email)) {
        return respond(400, { error: 'validation', field: 'email', message: 'Valid email required.' });
    }
    if (typeof attending !== 'boolean') {
        return respond(400, { error: 'validation', field: 'attending', message: 'attending must be a boolean.' });
    }
    for (const key of ['pairingsParty', 'day1', 'day2']) {
        if (body[key] !== undefined && typeof body[key] !== 'boolean') {
            return respond(400, { error: 'validation', field: key, message: `${key} must be a boolean if provided.` });
        }
    }

    const normalizedEmail = email.toLowerCase().trim();
    const normalizedName = name.trim();
    const effectiveParty = attending ? !!pairingsParty : false;
    const effectiveDay1 = attending ? !!day1 : false;
    const effectiveDay2 = attending ? !!day2 : false;
    const nowIso = new Date().toISOString();

    let existing;
    try {
        const res = await doc.send(new GetCommand({
            TableName: AVAILABILITY_TABLE,
            Key: { email: normalizedEmail },
        }));
        existing = res.Item;
    } catch (err) {
        console.error('[submit] GetItem failed:', err);
        return respond(500, { error: 'server', message: 'Could not read prior submissions.' });
    }

    const submissionCount = (existing?.submissionCount || 0) + 1;
    const firstSubmittedAt = existing?.firstSubmittedAt || nowIso;
    const userAgent = ((event.headers || {})['user-agent'] || (event.headers || {})['User-Agent'] || '').slice(0, 200);

    const item = {
        email: normalizedEmail,
        name: normalizedName,
        attending,
        pairingsParty: effectiveParty,
        day1: effectiveDay1,
        day2: effectiveDay2,
        firstSubmittedAt,
        updatedAt: nowIso,
        submissionCount,
        userAgent,
    };

    try {
        await doc.send(new PutCommand({ TableName: AVAILABILITY_TABLE, Item: item }));
    } catch (err) {
        console.error('[submit] PutItem failed:', err);
        return respond(500, { error: 'server', message: 'Could not save submission.' });
    }

    // Fire both emails but do NOT fail the submission if SES errors.
    try {
        await sendAdminEmail(item);
    } catch (err) {
        console.error('[submit] admin email failed:', err);
    }
    try {
        await sendSubmitterConfirmation(item);
    } catch (err) {
        console.error('[submit] confirmation email failed:', err);
    }

    return respond(200, {
        ok: true,
        submissionCount,
        updated: submissionCount > 1,
    });
};

function respond(statusCode, obj) {
    return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(obj) };
}

function partsSummary(item) {
    if (!item.attending) return 'declined';
    const parts = [];
    if (item.pairingsParty) parts.push('Party');
    if (item.day1) parts.push('Day 1');
    if (item.day2) parts.push('Day 2');
    if (parts.length === 0) return 'coming (no days selected)';
    return `coming (${parts.join(' + ')})`;
}

async function sendAdminEmail(item) {
    const updateTag = item.submissionCount > 1 ? 'RSVP UPDATE' : 'RSVP';
    const subject = `${updateTag}: ${item.name} — ${partsSummary(item)}`;
    const body = [
        `Name:      ${item.name}`,
        `Email:     ${item.email}`,
        `Attending: ${item.attending ? 'Yes' : 'No'}`,
        '',
        `Pairings party (Wed Oct 22):     ${item.pairingsParty ? 'Yes' : 'No'}`,
        `Day 1 team matches (Thu Oct 23): ${item.day1 ? 'Yes' : 'No'}`,
        `Day 2 singles (Fri Oct 24):      ${item.day2 ? 'Yes' : 'No'}`,
        '',
        `Submitted: ${item.updatedAt} UTC`,
        `Submission #${item.submissionCount} for this email${item.submissionCount > 1 ? ' (update)' : ' (first)'}.`,
        '',
        `Admin dashboard: https://www.lansdowne-international-cup.com/admin/availability.html`,
    ].join('\n');

    await ses.send(new SendEmailCommand({
        Source: SENDER_EMAIL,
        Destination: {
            ToAddresses: [SENDER_EMAIL],
            BccAddresses: NOTIFY_LIST,
        },
        Message: {
            Subject: { Charset: 'UTF-8', Data: subject },
            Body: { Text: { Charset: 'UTF-8', Data: body } },
        },
    }));
}

async function sendSubmitterConfirmation(item) {
    const updated = item.submissionCount > 1;
    const subject = updated ? 'Your updated RSVP' : 'Your International Cup 2026 RSVP';
    const body = [
        `Hi ${item.name},`,
        '',
        `Thanks for letting us know. Here's what we have on file:`,
        '',
        `  Attending:       ${item.attending ? 'Yes' : 'No'}`,
        `  Pairings party:  ${item.pairingsParty ? 'Yes' : 'No'}`,
        `  Day 1:           ${item.day1 ? 'Yes' : 'No'}`,
        `  Day 2:           ${item.day2 ? 'Yes' : 'No'}`,
        '',
        `Change your mind? Just re-submit at`,
        `https://www.lansdowne-international-cup.com/availability/`,
        '',
        `Questions? Reply to this email.`,
        '',
        `— International Cup 2026`,
    ].join('\n');

    await ses.send(new SendEmailCommand({
        Source: SENDER_EMAIL,
        Destination: { ToAddresses: [item.email] },
        Message: {
            Subject: { Charset: 'UTF-8', Data: subject },
            Body: { Text: { Charset: 'UTF-8', Data: body } },
        },
    }));
}
```

- [ ] **Step 2: Syntax check**

```bash
node --check lambda/submitAvailability/index.js
```

Expect no output, exit 0.

- [ ] **Step 3: Commit**

```bash
git add lambda/submitAvailability/index.js
git commit -m "$(cat <<'EOF'
Add submitAvailability Lambda handler

Public POST /availability handler: validates body (name, email,
attending, per-day booleans), normalizes email to lowercase-trimmed,
upserts an item in icup-availability-2026-prod keyed by email,
preserves firstSubmittedAt across upserts, increments submissionCount.
Sends two SES emails (admin BCC list + submitter confirmation);
email failure logs and returns 200 anyway (DDB write is authoritative).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `lambda/getAvailability/index.js`

Admin-gated GET handler. Password-check, scan, sort.

**Files:**
- Create: `lambda/getAvailability/index.js`

**Interfaces:**
- Consumes: env vars `AVAILABILITY_TABLE`, `ADMIN_PASSWORD`
- Produces: HTTP handler for `GET /availability`

- [ ] **Step 1: Write the handler**

Create `lambda/getAvailability/index.js`:

```javascript
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand } = require('@aws-sdk/lib-dynamodb');

const AVAILABILITY_TABLE = process.env.AVAILABILITY_TABLE;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!AVAILABILITY_TABLE) throw new Error('AVAILABILITY_TABLE env var is required');
if (!ADMIN_PASSWORD) throw new Error('ADMIN_PASSWORD env var is required');

const ddb = new DynamoDBClient({ region: 'us-east-1' });
const doc = DynamoDBDocumentClient.from(ddb);

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Password',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
};

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: CORS_HEADERS, body: '' };
    }

    const headers = event.headers || {};
    const provided = headers['x-admin-password'] || headers['X-Admin-Password'];
    if (!provided || provided !== ADMIN_PASSWORD) {
        return respond(401, { error: 'unauthorized' });
    }

    let items = [];
    let ExclusiveStartKey;
    try {
        do {
            const res = await doc.send(new ScanCommand({
                TableName: AVAILABILITY_TABLE,
                ExclusiveStartKey,
            }));
            items.push(...(res.Items || []));
            ExclusiveStartKey = res.LastEvaluatedKey;
        } while (ExclusiveStartKey);
    } catch (err) {
        console.error('[get] Scan failed:', err);
        return respond(500, { error: 'server', message: 'Could not read submissions.' });
    }

    items.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));

    return respond(200, { items, count: items.length });
};

function respond(statusCode, obj) {
    return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(obj) };
}
```

- [ ] **Step 2: Syntax check**

```bash
node --check lambda/getAvailability/index.js
```

Expect exit 0.

- [ ] **Step 3: Commit**

```bash
git add lambda/getAvailability/index.js
git commit -m "$(cat <<'EOF'
Add getAvailability Lambda handler

Admin-gated GET /availability handler: verifies X-Admin-Password
header against ADMIN_PASSWORD env var (throw at cold-start if unset,
matches the other admin Lambdas), scans icup-availability-2026-prod
with pagination, sorts by updatedAt desc, returns {items, count}.
CORS matches existing PairingsApi config.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Public form (`availability/index.html` + `js/availability.js` + `css/availability.css`)

The public-facing RSVP form. HTML page + IIFE JS + shared CSS.

**Files:**
- Create: `availability/index.html`, `js/availability.js`, `css/availability.css`

**Interfaces:**
- Consumes: `POST /availability` on the existing REST API
- Produces: shared `css/availability.css` also used by Task 5

- [ ] **Step 1: Create `css/availability.css`**

```css
/* Availability form + admin dashboard shared styles */

.availability-hero {
    max-width: 720px;
    margin: 6rem auto 1.5rem;
    padding: 0 1.5rem;
    text-align: center;
}

.availability-hero h1 { font-size: 2rem; margin-bottom: 0.5rem; }
.availability-hero p { color: #666; }

.availability-form {
    max-width: 720px;
    margin: 0 auto 4rem;
    padding: 2rem 1.5rem;
    background: #fff;
    border-radius: 12px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.06);
}

.availability-form fieldset { border: none; padding: 0; margin: 0 0 1.5rem; }
.availability-form legend { font-weight: 600; margin-bottom: 0.75rem; }

.availability-form label.field { display: block; margin-bottom: 1rem; }
.availability-form label.field span { display: block; font-weight: 600; margin-bottom: 0.25rem; }
.availability-form input[type="text"],
.availability-form input[type="email"] {
    width: 100%; padding: 0.6rem 0.75rem; border: 1px solid #cbd5e1;
    border-radius: 6px; font-size: 1rem; box-sizing: border-box;
}

.availability-form .radio-row, .availability-form .checkbox-row { display: flex; gap: 0.5rem; align-items: center; margin-bottom: 0.5rem; }
.availability-form .radio-row input, .availability-form .checkbox-row input { flex-shrink: 0; }
.availability-form .days-block { padding: 1rem; background: #f8fafc; border-radius: 8px; margin-top: 0.5rem; }
.availability-form .days-block[hidden] { display: none; }

.availability-form .submit-row {
    display: flex; justify-content: center; margin-top: 1.5rem;
}
.availability-form button {
    padding: 0.75rem 2rem; background: #667eea; color: #fff;
    border: none; border-radius: 8px; font-size: 1rem; font-weight: 600;
    cursor: pointer;
}
.availability-form button:disabled { opacity: 0.6; cursor: wait; }
.availability-form button:hover:not(:disabled) { background: #5568d3; }

.availability-form .status { margin-top: 1rem; padding: 1rem; border-radius: 8px; text-align: center; }
.availability-form .status.ok { background: #d1fae5; color: #065f46; }
.availability-form .status.err { background: #fee2e2; color: #991b1b; }
.availability-form .status[hidden] { display: none; }

/* Admin dashboard */
.availability-admin { max-width: 1200px; margin: 6rem auto 4rem; padding: 0 1.5rem; }
.availability-admin h1 { margin-bottom: 0.5rem; }
.availability-admin .summary { color: #444; margin-bottom: 1rem; }
.availability-admin .toolbar { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 1rem; }
.availability-admin .chip {
    padding: 0.4rem 0.9rem; background: #e2e8f0; border: none;
    border-radius: 999px; cursor: pointer; font-size: 0.9rem;
}
.availability-admin .chip.active { background: #667eea; color: #fff; }
.availability-admin .export {
    margin-left: auto; padding: 0.4rem 1rem; background: #10b981;
    color: #fff; border: none; border-radius: 6px; cursor: pointer;
}
.availability-admin table { width: 100%; border-collapse: collapse; font-size: 0.9rem; background: #fff; box-shadow: 0 2px 6px rgba(0,0,0,0.06); border-radius: 8px; overflow: hidden; }
.availability-admin th, .availability-admin td { padding: 0.6rem 0.75rem; border-bottom: 1px solid #eee; text-align: left; }
.availability-admin th { background: #f8fafc; cursor: pointer; user-select: none; }
.availability-admin tr:hover { background: #f8fafc; }
.availability-admin .yes { color: #065f46; font-weight: 600; }
.availability-admin .no { color: #991b1b; }
.availability-admin .updated-row { background: #fef3c7; }
```

- [ ] **Step 2: Create `js/availability.js`**

```javascript
(function () {
    var API_URL = 'https://qzq9gvuk9f.execute-api.us-east-1.amazonaws.com/prod/availability';
    // No staging Lambdas are stood up for this feature — staging URL also hits prod API.
    // (Documented in the spec §5.)

    document.addEventListener('DOMContentLoaded', init);

    function init() {
        var form = document.getElementById('availability-form');
        var attendingYes = document.getElementById('attending-yes');
        var attendingNo = document.getElementById('attending-no');
        var daysBlock = document.getElementById('days-block');
        var status = document.getElementById('status');
        var submit = document.getElementById('submit-btn');

        function updateDaysVisibility() {
            var showing = attendingYes.checked;
            daysBlock.hidden = !showing;
        }
        attendingYes.addEventListener('change', updateDaysVisibility);
        attendingNo.addEventListener('change', updateDaysVisibility);
        updateDaysVisibility();

        form.addEventListener('submit', function (e) {
            e.preventDefault();
            status.hidden = true;
            status.textContent = '';
            status.classList.remove('ok', 'err');

            var name = document.getElementById('name').value.trim();
            var email = document.getElementById('email').value.trim();
            var attending = attendingYes.checked;

            if (!name) return showErr('Please enter your name.');
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showErr('Please enter a valid email.');
            if (!attendingYes.checked && !attendingNo.checked) return showErr('Please choose Yes or No.');

            var body = {
                name: name,
                email: email,
                attending: attending,
                pairingsParty: attending && document.getElementById('day-party').checked,
                day1: attending && document.getElementById('day-1').checked,
                day2: attending && document.getElementById('day-2').checked,
            };

            submit.disabled = true;
            submit.textContent = 'Submitting…';

            fetch(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            })
                .then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j }; }); })
                .then(function (res) {
                    if (res.status !== 200) {
                        return showErr(res.body.message || 'Submission failed. Please try again.');
                    }
                    var parts = [];
                    if (body.pairingsParty) parts.push('Party');
                    if (body.day1) parts.push('Day 1');
                    if (body.day2) parts.push('Day 2');
                    var summary;
                    if (!attending) summary = 'Sorry you can\'t make it this year.';
                    else if (parts.length === 0) summary = 'Coming but no days selected — did you mean to check some?';
                    else summary = 'Coming for: ' + parts.join(' + ') + '.';
                    var lead = res.body.updated ? 'Thanks, ' + name + ' — updated your RSVP. ' : 'Thanks, ' + name + '. ';
                    showOk(lead + summary + ' Check your email for confirmation.');
                })
                .catch(function (err) {
                    console.error('[availability] submit failed', err);
                    showErr('Network error. Please try again.');
                })
                .finally(function () {
                    submit.disabled = false;
                    submit.textContent = 'Submit RSVP';
                });
        });

        function showErr(msg) { status.textContent = msg; status.classList.add('err'); status.hidden = false; return false; }
        function showOk(msg) { status.textContent = msg; status.classList.add('ok'); status.hidden = false; }
    }
})();
```

- [ ] **Step 3: Create `availability/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="robots" content="index, follow">
    <title>RSVP · International Cup 2026</title>
    <link rel="stylesheet" href="../css/styles.css">
    <link rel="stylesheet" href="../css/availability.css?v=2026-08-20">
    <link rel="icon" href="../favicon.ico">
</head>
<body>
    <nav class="navbar">
        <div class="nav-container">
            <a href="../" class="nav-logo">International Cup</a>
            <div class="nav-menu">
                <a href="../" class="nav-link">Home</a>
                <a href="../#teams" class="nav-link">Teams</a>
                <a href="../#schedule" class="nav-link">Schedule</a>
                <a href="./" class="nav-link" aria-current="page">RSVP</a>
            </div>
        </div>
    </nav>

    <header class="availability-hero">
        <h1>🏌️ Playing the 2026 International Cup?</h1>
        <p>October 22–24 · Venue TBA · Let us know if you're in.</p>
    </header>

    <main>
        <form class="availability-form" id="availability-form" novalidate>
            <fieldset>
                <legend>Your info</legend>
                <label class="field">
                    <span>Name</span>
                    <input type="text" id="name" name="name" required autocomplete="name" maxlength="100">
                </label>
                <label class="field">
                    <span>Email</span>
                    <input type="email" id="email" name="email" required autocomplete="email" maxlength="200">
                </label>
            </fieldset>

            <fieldset>
                <legend>Availability</legend>
                <label class="radio-row">
                    <input type="radio" id="attending-yes" name="attending" value="yes">
                    <span>Yes, I'm in</span>
                </label>
                <label class="radio-row">
                    <input type="radio" id="attending-no" name="attending" value="no">
                    <span>Can't make it this year</span>
                </label>

                <div class="days-block" id="days-block" hidden>
                    <p style="margin: 0 0 0.5rem; font-weight: 600;">Which parts? (check all that apply)</p>
                    <label class="checkbox-row">
                        <input type="checkbox" id="day-party" checked>
                        <span>Pairings party — Wed Oct 22 evening</span>
                    </label>
                    <label class="checkbox-row">
                        <input type="checkbox" id="day-1" checked>
                        <span>Day 1 team matches — Thu Oct 23</span>
                    </label>
                    <label class="checkbox-row">
                        <input type="checkbox" id="day-2" checked>
                        <span>Day 2 singles — Fri Oct 24</span>
                    </label>
                </div>
            </fieldset>

            <div class="submit-row">
                <button type="submit" id="submit-btn">Submit RSVP</button>
            </div>
            <div class="status" id="status" hidden></div>
        </form>
    </main>

    <footer style="text-align:center; padding: 2rem 1rem; color: #666;">
        <p>© 2026 International Cup</p>
    </footer>

    <script src="../js/availability.js?v=2026-08-20"></script>
</body>
</html>
```

- [ ] **Step 4: Local sanity check**

```bash
node --check js/availability.js && echo JS_OK
python3 -m http.server 8000 &
sleep 1
curl -s http://localhost:8000/availability/ | grep -c "Submit RSVP"
kill %1 2>/dev/null
```

Expect: `JS_OK` and `1` (title/button string present).

- [ ] **Step 5: Commit**

```bash
git add availability/ js/availability.js css/availability.css
git commit -m "$(cat <<'EOF'
Add /availability/ public RSVP form

Standalone form page (Name, Email, Yes/No + three day checkboxes)
that POSTs to /availability. IIFE JS handles the reveal-on-Yes toggle,
client-side validation (email regex), and shows the response summary
inline. Small css/availability.css also styles the admin dashboard
that follows in the next commit.

Frontend hits the prod API from both prod and staging hosts — no
staging Lambdas are stood up for this feature (spec §5).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Admin dashboard (`admin/availability.html` + `js/availability-admin.js`)

Password-gated admin dashboard. Table view + filter chips + client-side CSV export.

**Files:**
- Create: `admin/availability.html`, `js/availability-admin.js`

**Interfaces:**
- Consumes: `GET /availability` with `X-Admin-Password` header; shared `css/availability.css` from Task 4

- [ ] **Step 1: Create `js/availability-admin.js`**

```javascript
(function () {
    var API_URL = 'https://qzq9gvuk9f.execute-api.us-east-1.amazonaws.com/prod/availability';
    var STORAGE_KEY = 'icup-admin-password';

    var currentItems = [];
    var currentFilter = 'all';
    var currentSort = { key: 'updatedAt', dir: 'desc' };

    document.addEventListener('DOMContentLoaded', init);

    function init() {
        var loginBtn = document.getElementById('login-btn');
        var loginInput = document.getElementById('password-input');
        var loginError = document.getElementById('login-error');
        var loginBox = document.getElementById('login-box');
        var dashboard = document.getElementById('dashboard');
        var chips = document.querySelectorAll('.chip');
        var exportBtn = document.getElementById('export-btn');

        var stored = sessionStorage.getItem(STORAGE_KEY);
        if (stored) {
            tryLoad(stored, function (ok) {
                if (ok) { showDashboard(); }
                else { sessionStorage.removeItem(STORAGE_KEY); }
            });
        }

        loginBtn.addEventListener('click', function () {
            var pw = loginInput.value;
            if (!pw) return;
            loginError.hidden = true;
            tryLoad(pw, function (ok) {
                if (ok) {
                    sessionStorage.setItem(STORAGE_KEY, pw);
                    showDashboard();
                } else {
                    loginError.hidden = false;
                }
            });
        });
        loginInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') loginBtn.click(); });

        chips.forEach(function (chip) {
            chip.addEventListener('click', function () {
                chips.forEach(function (c) { c.classList.remove('active'); });
                chip.classList.add('active');
                currentFilter = chip.dataset.filter;
                render();
            });
        });

        exportBtn.addEventListener('click', exportCsv);

        document.addEventListener('click', function (e) {
            var th = e.target.closest('th[data-sortkey]');
            if (!th) return;
            var key = th.dataset.sortkey;
            if (currentSort.key === key) currentSort.dir = currentSort.dir === 'desc' ? 'asc' : 'desc';
            else { currentSort.key = key; currentSort.dir = 'asc'; }
            render();
        });

        function showDashboard() {
            loginBox.hidden = true;
            dashboard.hidden = false;
        }
    }

    function tryLoad(password, cb) {
        fetch(API_URL, { headers: { 'X-Admin-Password': password } })
            .then(function (r) {
                if (r.status === 401) return cb(false);
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json().then(function (j) {
                    currentItems = j.items || [];
                    render();
                    cb(true);
                });
            })
            .catch(function (err) {
                console.error('[admin] load failed', err);
                cb(false);
            });
    }

    function filtered() {
        if (currentFilter === 'attending') return currentItems.filter(function (i) { return i.attending; });
        if (currentFilter === 'declined') return currentItems.filter(function (i) { return !i.attending; });
        if (currentFilter === 'updated') return currentItems.filter(function (i) { return (i.submissionCount || 0) > 1; });
        return currentItems;
    }

    function sorted(items) {
        var key = currentSort.key;
        var dir = currentSort.dir === 'desc' ? -1 : 1;
        return items.slice().sort(function (a, b) {
            var av = a[key];
            var bv = b[key];
            if (av === bv) return 0;
            if (av === undefined) return 1;
            if (bv === undefined) return -1;
            return av < bv ? -dir : dir;
        });
    }

    function render() {
        var items = sorted(filtered());
        var attendingCount = currentItems.filter(function (i) { return i.attending; }).length;
        var declinedCount = currentItems.filter(function (i) { return !i.attending; }).length;
        var updatedCount = currentItems.filter(function (i) { return (i.submissionCount || 0) > 1; }).length;
        document.getElementById('summary').textContent =
            attendingCount + ' attending · ' + declinedCount + ' declined · ' + updatedCount + ' updated';

        var tbody = document.getElementById('rows');
        tbody.innerHTML = items.map(function (it) {
            var rowClass = (it.submissionCount || 0) > 1 ? 'updated-row' : '';
            return '<tr class="' + rowClass + '">'
                + td(esc(it.name || ''))
                + td(esc(it.email || ''))
                + td(it.attending ? '<span class="yes">Yes</span>' : '<span class="no">No</span>')
                + td(bool(it.pairingsParty))
                + td(bool(it.day1))
                + td(bool(it.day2))
                + td(fmt(it.firstSubmittedAt))
                + td(fmt(it.updatedAt))
                + td(String(it.submissionCount || 1))
                + '</tr>';
        }).join('');
    }

    function td(html) { return '<td>' + html + '</td>'; }
    function bool(v) { return v ? '<span class="yes">✓</span>' : '<span class="no">–</span>'; }
    function fmt(iso) { if (!iso) return ''; try { return new Date(iso).toLocaleString(); } catch (e) { return esc(iso); } }
    function esc(s) {
        return String(s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function exportCsv() {
        var items = sorted(filtered());
        var header = ['Name', 'Email', 'Attending', 'Party', 'Day1', 'Day2', 'FirstSubmittedAt', 'UpdatedAt', 'SubmissionCount'];
        var rows = items.map(function (it) {
            return [
                it.name || '',
                it.email || '',
                it.attending ? 'Yes' : 'No',
                it.pairingsParty ? 'Yes' : 'No',
                it.day1 ? 'Yes' : 'No',
                it.day2 ? 'Yes' : 'No',
                it.firstSubmittedAt || '',
                it.updatedAt || '',
                String(it.submissionCount || 1),
            ];
        });
        var csv = [header].concat(rows).map(function (r) {
            return r.map(function (v) {
                var s = String(v);
                return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
            }).join(',');
        }).join('\n');
        var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'availability-2026.csv';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
})();
```

- [ ] **Step 2: Create `admin/availability.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="robots" content="noindex, nofollow">
    <title>Availability RSVPs · Admin</title>
    <link rel="stylesheet" href="../css/styles.css">
    <link rel="stylesheet" href="../css/availability.css?v=2026-08-20">
    <link rel="icon" href="../favicon.ico">
    <style>
        .login-box {
            max-width: 400px; margin: 8rem auto 4rem; padding: 2rem;
            background: #fff; border-radius: 12px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.08);
        }
        .login-box h2 { margin-bottom: 1rem; }
        .login-box input {
            width: 100%; padding: 0.6rem 0.75rem; border: 1px solid #cbd5e1;
            border-radius: 6px; font-size: 1rem; box-sizing: border-box; margin-bottom: 1rem;
        }
        .login-box button {
            width: 100%; padding: 0.75rem; background: #667eea; color: #fff;
            border: none; border-radius: 8px; font-weight: 600; cursor: pointer;
        }
        .login-error { color: #991b1b; margin-top: 0.5rem; text-align: center; }
    </style>
</head>
<body>
    <nav class="navbar">
        <div class="nav-container">
            <a href="../" class="nav-logo">International Cup</a>
            <div class="nav-menu">
                <a href="../" class="nav-link">Home</a>
                <a href="./" class="nav-link" aria-current="page">Admin</a>
            </div>
        </div>
    </nav>

    <div class="login-box" id="login-box">
        <h2>Availability admin</h2>
        <input type="password" id="password-input" placeholder="Admin password" autocomplete="current-password">
        <button id="login-btn">Unlock</button>
        <p class="login-error" id="login-error" hidden>Wrong password.</p>
    </div>

    <main class="availability-admin" id="dashboard" hidden>
        <h1>Availability RSVPs — 2026</h1>
        <p class="summary" id="summary"></p>
        <div class="toolbar">
            <button class="chip active" data-filter="all">All</button>
            <button class="chip" data-filter="attending">Attending</button>
            <button class="chip" data-filter="declined">Declined</button>
            <button class="chip" data-filter="updated">Updated</button>
            <button class="export" id="export-btn">Export CSV</button>
        </div>
        <table>
            <thead>
                <tr>
                    <th data-sortkey="name">Name</th>
                    <th data-sortkey="email">Email</th>
                    <th data-sortkey="attending">Attending</th>
                    <th data-sortkey="pairingsParty">Party</th>
                    <th data-sortkey="day1">Day 1</th>
                    <th data-sortkey="day2">Day 2</th>
                    <th data-sortkey="firstSubmittedAt">First RSVP</th>
                    <th data-sortkey="updatedAt">Last update</th>
                    <th data-sortkey="submissionCount">Count</th>
                </tr>
            </thead>
            <tbody id="rows"></tbody>
        </table>
    </main>

    <script src="../js/availability-admin.js?v=2026-08-20"></script>
</body>
</html>
```

- [ ] **Step 3: Local sanity check**

```bash
node --check js/availability-admin.js && echo JS_OK
python3 -m http.server 8000 &
sleep 1
curl -s http://localhost:8000/admin/availability.html | grep -c "Availability RSVPs"
kill %1 2>/dev/null
```

Expect: `JS_OK` and `2` (title + h1 both contain the string).

- [ ] **Step 4: Commit**

```bash
git add admin/availability.html js/availability-admin.js
git commit -m "$(cat <<'EOF'
Add availability admin dashboard

Password-gated (X-Admin-Password header) dashboard at
/admin/availability.html. Loads all RSVP entries via GET /availability,
renders a sortable table with filter chips (All / Attending / Declined
/ Updated) and a client-side CSV export. Password cached in
sessionStorage so admins don't re-enter on tab reload; wrong password
shows an error, valid password unlocks the dashboard.

Reuses css/availability.css from Task 4 for shared styles.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Nav + admin menu + workflow updates

Three trivial edits that surface the new pages.

**Files:**
- Modify: `index.html` (top nav), `admin/index.html` (menu), `.github/workflows/deploy.yml` (build step)

- [ ] **Step 1: Add RSVP link to home page top nav**

In `index.html`, find the `<div class="nav-menu">` block containing the existing links. Add a new `nav-link` for RSVP. Insert AFTER the `Schedule` link:

Current (approximate):
```html
<a href="#schedule" class="nav-link">Schedule</a>
<a href="#history" class="nav-link">History</a>
```

Change to:
```html
<a href="#schedule" class="nav-link">Schedule</a>
<a href="availability/" class="nav-link">RSVP</a>
<a href="#history" class="nav-link">History</a>
```

Verify with `grep -n 'href="availability/"' index.html` — expect 1 match.

- [ ] **Step 2: Add "Availability RSVPs" card to admin menu**

In `admin/index.html`, find the `<ul class="admin-links">` and add a fourth `<li>` after the Tournament results entry:

```html
      <li>
        <a href="./availability.html">
          <strong>Availability RSVPs</strong>
          <span>Review who's signed up for the 2026 tournament.</span>
        </a>
      </li>
```

Verify with `grep -n 'availability.html' admin/index.html` — expect 1 match.

- [ ] **Step 3: Add `availability/` to deploy workflow**

In `.github/workflows/deploy.yml`, find the two "Copy tournament folder" blocks (one in `deploy-production` job, one in `deploy-staging` job). Add an identical `availability/` block DIRECTLY AFTER each:

```yaml
        # Copy availability folder if it exists
        if [ -d availability ]; then
          cp -r availability build/
        fi
```

Preserve the exact 8-space indentation matching neighboring `if [ -d ... ]` blocks.

- [ ] **Step 4: Validate YAML**

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/deploy.yml'))" && echo YAML_OK
grep -n "Copy availability folder" .github/workflows/deploy.yml
```

Expect: `YAML_OK` and 2 matches.

- [ ] **Step 5: Commit**

```bash
git add index.html admin/index.html .github/workflows/deploy.yml
git commit -m "$(cat <<'EOF'
Surface availability form: home nav, admin menu, deploy workflow

- Adds "RSVP" nav link to index.html top nav (between Schedule and
  History)
- Adds "Availability RSVPs" card to admin/index.html menu (fourth
  entry after Tournament results)
- Adds cp -r availability build/ to both prod and staging deploy jobs,
  mirroring the pattern established for history/ and tournament/

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: `scripts/setup-availability-2026.js`

One-shot orchestrator. Creates DynamoDB table, IAM role, Lambdas, API Gateway routes. Idempotent.

**Files:**
- Create: `scripts/setup-availability-2026.js`

**Interfaces:**
- Consumes: `scripts/lib/aws.js` (`getClients`, `assertAccount`); `~/.icup-admin-passwords/prod-2026-08-20.txt`
- Consumes: `lambda/submitAvailability/`, `lambda/getAvailability/` (packaged into zips)
- Produces: AWS resources (DDB table, IAM role, 2 Lambdas, API GW resource + methods + deployment)

The script has 6 phases (§8.2 of spec). Because this file is large (~350 lines), the code is provided in sections below; the implementer copies each section into the file in order.

- [ ] **Step 1: Create the script file with imports + top-level flow**

```javascript
#!/usr/bin/env node
import { readFileSync, existsSync, statSync } from 'node:fs';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';
import {
    DynamoDBClient,
    CreateTableCommand,
    DescribeTableCommand,
    ResourceNotFoundException,
    waitUntilTableExists,
} from '@aws-sdk/client-dynamodb';
import {
    IAMClient,
    CreateRoleCommand,
    GetRoleCommand,
    AttachRolePolicyCommand,
    PutRolePolicyCommand,
    NoSuchEntityException,
} from '@aws-sdk/client-iam';
import {
    LambdaClient,
    CreateFunctionCommand,
    GetFunctionCommand,
    UpdateFunctionCodeCommand,
    UpdateFunctionConfigurationCommand,
    AddPermissionCommand,
    waitUntilFunctionActive,
    waitUntilFunctionUpdated,
    ResourceConflictException,
} from '@aws-sdk/client-lambda';
import {
    APIGatewayClient,
    GetResourcesCommand,
    CreateResourceCommand,
    PutMethodCommand,
    PutIntegrationCommand,
    PutMethodResponseCommand,
    PutIntegrationResponseCommand,
    CreateDeploymentCommand,
} from '@aws-sdk/client-api-gateway';
import { CloudFormationClient, ListStackResourcesCommand } from '@aws-sdk/client-cloudformation';
import { getClients, assertAccount } from './lib/aws.js';

const REGION = 'us-east-1';
const ACCOUNT_ID = '792782029232';
const TABLE_NAME = 'icup-availability-2026-prod';
const ROLE_NAME = 'icup-availability-lambda-role';
const SUBMIT_FN = 'icup-submit-availability';
const GET_FN = 'icup-get-availability';
const STACK_NAME = 'icup-pairings-prod';
const API_STAGE = 'prod';
const SENDER_EMAIL = 'noreply@lansdowne-international-cup.com';
const NOTIFY_EMAIL = 'erikwagner77@gmail.com,ash@cavlog.com,tim_pearce36@hotmail.com';
const PROD_PASSWORD_FILE = resolve(homedir(), '.icup-admin-passwords/prod-2026-08-20.txt');
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const iam = new IAMClient({ region: REGION });
const lambda = new LambdaClient({ region: REGION });
const apigw = new APIGatewayClient({ region: REGION });
const cfn = new CloudFormationClient({ region: REGION });

async function main() {
    await assertAccount();
    await precheck();
    await createTable();
    const roleArn = await createRole();
    await sleep(10000); // IAM propagation delay before Lambda can assume the role
    await packageAndDeployLambdas(roleArn);
    const { apiId, resourceId } = await wireApiGateway();
    await deployApi(apiId);
    await verify(apiId);
    console.log('\n[ok] availability setup complete');
    console.log(`  POST/GET https://${apiId}.execute-api.${REGION}.amazonaws.com/${API_STAGE}/availability`);
}

main().catch((err) => {
    console.error('[fatal]', err);
    process.exit(1);
});

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
```

- [ ] **Step 2: Implement `precheck()`**

Append to `scripts/setup-availability-2026.js`:

```javascript
async function precheck() {
    console.log('\n=== precheck ===');
    if (!existsSync(PROD_PASSWORD_FILE)) {
        throw new Error(`missing ${PROD_PASSWORD_FILE} — cannot set ADMIN_PASSWORD env var on getAvailability Lambda`);
    }
    const pwStat = statSync(PROD_PASSWORD_FILE);
    if ((pwStat.mode & 0o077) !== 0) {
        console.warn(`[warn] ${PROD_PASSWORD_FILE} is world/group-readable — chmod 600 recommended`);
    }
    const submitDir = resolve(REPO_ROOT, 'lambda/submitAvailability');
    const getDir = resolve(REPO_ROOT, 'lambda/getAvailability');
    for (const d of [submitDir, getDir]) {
        if (!existsSync(resolve(d, 'index.js'))) throw new Error(`missing ${resolve(d, 'index.js')}`);
        if (!existsSync(resolve(d, 'package.json'))) throw new Error(`missing ${resolve(d, 'package.json')}`);
    }
    console.log('  [OK] password file present, Lambda dirs present');
}
```

- [ ] **Step 3: Implement `createTable()`**

Append:

```javascript
async function createTable() {
    const { ddb } = getClients();
    try {
        await ddb.send(new DescribeTableCommand({ TableName: TABLE_NAME }));
        console.log(`\n=== ${TABLE_NAME} already exists — skip create ===`);
        return;
    } catch (err) {
        if (!(err instanceof ResourceNotFoundException)) throw err;
    }
    console.log(`\n=== create ${TABLE_NAME} ===`);
    await ddb.send(new CreateTableCommand({
        TableName: TABLE_NAME,
        AttributeDefinitions: [{ AttributeName: 'email', AttributeType: 'S' }],
        KeySchema: [{ AttributeName: 'email', KeyType: 'HASH' }],
        BillingMode: 'PAY_PER_REQUEST',
    }));
    await waitUntilTableExists({ client: ddb, maxWaitTime: 120 }, { TableName: TABLE_NAME });
    console.log('  [OK] created');
}
```

- [ ] **Step 4: Implement `createRole()`**

Append:

```javascript
async function createRole() {
    console.log(`\n=== IAM role ${ROLE_NAME} ===`);
    let existing;
    try {
        existing = await iam.send(new GetRoleCommand({ RoleName: ROLE_NAME }));
        console.log('  [OK] role already exists');
    } catch (err) {
        if (!(err instanceof NoSuchEntityException)) throw err;
    }

    if (!existing) {
        const trust = {
            Version: '2012-10-17',
            Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }],
        };
        const res = await iam.send(new CreateRoleCommand({
            RoleName: ROLE_NAME,
            AssumeRolePolicyDocument: JSON.stringify(trust),
            Description: 'Availability form Lambda role — narrow DDB + SES only',
        }));
        existing = res;
        console.log('  [OK] role created');

        await iam.send(new AttachRolePolicyCommand({
            RoleName: ROLE_NAME,
            PolicyArn: 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
        }));
        console.log('  [OK] AWSLambdaBasicExecutionRole attached');
    }

    // Idempotent PutRolePolicy — always sets the inline policy to the intended version.
    const inline = {
        Version: '2012-10-17',
        Statement: [
            {
                Sid: 'AvailabilityTable',
                Effect: 'Allow',
                Action: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:Scan'],
                Resource: `arn:aws:dynamodb:${REGION}:${ACCOUNT_ID}:table/${TABLE_NAME}`,
            },
            {
                Sid: 'SendMail',
                Effect: 'Allow',
                Action: ['ses:SendEmail'],
                Resource: '*',
            },
        ],
    };
    await iam.send(new PutRolePolicyCommand({
        RoleName: ROLE_NAME,
        PolicyName: 'availability-inline',
        PolicyDocument: JSON.stringify(inline),
    }));
    console.log('  [OK] inline policy set');

    return existing.Role.Arn;
}
```

- [ ] **Step 5: Implement `packageAndDeployLambdas(roleArn)`**

Append:

```javascript
async function packageAndDeployLambdas(roleArn) {
    const adminPassword = readFileSync(PROD_PASSWORD_FILE, 'utf8').trim();

    await deployLambda({
        name: SUBMIT_FN,
        dir: resolve(REPO_ROOT, 'lambda/submitAvailability'),
        roleArn,
        env: {
            AVAILABILITY_TABLE: TABLE_NAME,
            NOTIFY_EMAIL,
            SENDER_EMAIL,
        },
    });

    await deployLambda({
        name: GET_FN,
        dir: resolve(REPO_ROOT, 'lambda/getAvailability'),
        roleArn,
        env: {
            AVAILABILITY_TABLE: TABLE_NAME,
            ADMIN_PASSWORD: adminPassword,
        },
    });
}

async function deployLambda({ name, dir, roleArn, env }) {
    console.log(`\n=== Lambda ${name} ===`);
    console.log(`  installing deps in ${dir}`);
    execSync('npm install --production --no-audit --no-fund', { cwd: dir, stdio: 'inherit' });
    const zipPath = `/tmp/${name}.zip`;
    execSync(`rm -f ${zipPath} && cd ${dir} && zip -qr ${zipPath} .`, { stdio: 'inherit' });

    let exists = false;
    try {
        await lambda.send(new GetFunctionCommand({ FunctionName: name }));
        exists = true;
    } catch (err) {
        if (err.name !== 'ResourceNotFoundException') throw err;
    }

    const zipBuf = readFileSync(zipPath);

    if (!exists) {
        console.log('  creating…');
        await lambda.send(new CreateFunctionCommand({
            FunctionName: name,
            Runtime: 'nodejs18.x',
            Role: roleArn,
            Handler: 'index.handler',
            Code: { ZipFile: zipBuf },
            Timeout: 15,
            MemorySize: 256,
            Environment: { Variables: env },
        }));
        await waitUntilFunctionActive({ client: lambda, maxWaitTime: 60 }, { FunctionName: name });
        console.log('  [OK] created');
    } else {
        console.log('  updating code…');
        await lambda.send(new UpdateFunctionCodeCommand({ FunctionName: name, ZipFile: zipBuf }));
        await waitUntilFunctionUpdated({ client: lambda, maxWaitTime: 60 }, { FunctionName: name });
        console.log('  updating configuration…');
        await lambda.send(new UpdateFunctionConfigurationCommand({
            FunctionName: name,
            Environment: { Variables: env },
            Runtime: 'nodejs18.x',
            Handler: 'index.handler',
            Timeout: 15,
            MemorySize: 256,
        }));
        await waitUntilFunctionUpdated({ client: lambda, maxWaitTime: 60 }, { FunctionName: name });
        console.log('  [OK] updated');
    }
}
```

- [ ] **Step 6: Implement `wireApiGateway()`**

Append:

```javascript
async function wireApiGateway() {
    console.log('\n=== API Gateway wiring ===');
    const stackRes = await cfn.send(new ListStackResourcesCommand({ StackName: STACK_NAME }));
    const apiSummary = (stackRes.StackResourceSummaries || []).find((r) => r.ResourceType === 'AWS::ApiGateway::RestApi');
    if (!apiSummary) throw new Error(`could not find RestApi in stack ${STACK_NAME}`);
    const apiId = apiSummary.PhysicalResourceId;
    console.log(`  REST API id: ${apiId}`);

    const resourcesRes = await apigw.send(new GetResourcesCommand({ restApiId: apiId, limit: 500 }));
    const root = (resourcesRes.items || []).find((r) => r.path === '/');
    if (!root) throw new Error('no root resource on REST API');
    let availability = (resourcesRes.items || []).find((r) => r.path === '/availability');

    if (!availability) {
        console.log('  creating /availability resource');
        availability = await apigw.send(new CreateResourceCommand({
            restApiId: apiId, parentId: root.id, pathPart: 'availability',
        }));
    } else {
        console.log('  /availability resource already exists');
    }

    await ensureMethod({ apiId, resourceId: availability.id, method: 'POST', fnName: SUBMIT_FN });
    await ensureMethod({ apiId, resourceId: availability.id, method: 'GET', fnName: GET_FN });
    await ensureOptionsMethod({ apiId, resourceId: availability.id });

    return { apiId, resourceId: availability.id };
}

async function ensureMethod({ apiId, resourceId, method, fnName }) {
    const fnArn = `arn:aws:lambda:${REGION}:${ACCOUNT_ID}:function:${fnName}`;
    console.log(`  [${method}] wiring to ${fnName}`);
    try {
        await apigw.send(new PutMethodCommand({
            restApiId: apiId, resourceId, httpMethod: method,
            authorizationType: 'NONE', apiKeyRequired: false,
        }));
    } catch (err) {
        if (err.name !== 'ConflictException') throw err;
    }
    await apigw.send(new PutIntegrationCommand({
        restApiId: apiId, resourceId, httpMethod: method,
        type: 'AWS_PROXY', integrationHttpMethod: 'POST',
        uri: `arn:aws:apigateway:${REGION}:lambda:path/2015-03-31/functions/${fnArn}/invocations`,
    }));
    // Grant API Gateway permission to invoke the Lambda (idempotent — catch on already-exists)
    try {
        await lambda.send(new AddPermissionCommand({
            FunctionName: fnName,
            StatementId: `apigw-${method}-availability`,
            Action: 'lambda:InvokeFunction',
            Principal: 'apigateway.amazonaws.com',
            SourceArn: `arn:aws:execute-api:${REGION}:${ACCOUNT_ID}:${apiId}/*/${method}/availability`,
        }));
    } catch (err) {
        if (!(err instanceof ResourceConflictException)) throw err;
    }
}

async function ensureOptionsMethod({ apiId, resourceId }) {
    console.log('  [OPTIONS] mock integration for CORS preflight');
    try {
        await apigw.send(new PutMethodCommand({
            restApiId: apiId, resourceId, httpMethod: 'OPTIONS',
            authorizationType: 'NONE', apiKeyRequired: false,
        }));
    } catch (err) {
        if (err.name !== 'ConflictException') throw err;
    }
    await apigw.send(new PutMethodResponseCommand({
        restApiId: apiId, resourceId, httpMethod: 'OPTIONS', statusCode: '200',
        responseParameters: {
            'method.response.header.Access-Control-Allow-Headers': true,
            'method.response.header.Access-Control-Allow-Methods': true,
            'method.response.header.Access-Control-Allow-Origin': true,
        },
    }));
    await apigw.send(new PutIntegrationCommand({
        restApiId: apiId, resourceId, httpMethod: 'OPTIONS',
        type: 'MOCK',
        requestTemplates: { 'application/json': '{"statusCode": 200}' },
    }));
    await apigw.send(new PutIntegrationResponseCommand({
        restApiId: apiId, resourceId, httpMethod: 'OPTIONS', statusCode: '200',
        responseParameters: {
            'method.response.header.Access-Control-Allow-Headers': "'Content-Type,X-Admin-Password'",
            'method.response.header.Access-Control-Allow-Methods': "'GET,POST,OPTIONS'",
            'method.response.header.Access-Control-Allow-Origin': "'*'",
        },
        responseTemplates: { 'application/json': '' },
    }));
}
```

- [ ] **Step 7: Implement `deployApi()` and `verify()`**

Append:

```javascript
async function deployApi(apiId) {
    console.log('\n=== deploy API stage ===');
    await apigw.send(new CreateDeploymentCommand({
        restApiId: apiId, stageName: API_STAGE,
        description: 'availability form: initial deploy',
    }));
    console.log('  [OK] deployed to stage prod');
}

async function verify(apiId) {
    console.log('\n=== verify ===');
    const url = `https://${apiId}.execute-api.${REGION}.amazonaws.com/${API_STAGE}/availability`;
    // OPTIONS should return 200
    const optionsRes = await fetch(url, { method: 'OPTIONS' });
    console.log(`  OPTIONS ${url} → ${optionsRes.status}`);
    // GET with wrong password should return 401
    const getRes = await fetch(url, { method: 'GET', headers: { 'X-Admin-Password': 'not-the-password' } });
    console.log(`  GET (wrong pw) → ${getRes.status} (expect 401)`);
    if (getRes.status !== 401) throw new Error(`getAvailability did not enforce auth: ${getRes.status}`);
    console.log('  [OK] endpoint reachable and auth-enforced');
}
```

- [ ] **Step 8: Sanity-check syntax**

```bash
node --check scripts/setup-availability-2026.js && echo OK
```

Expect `OK`.

Note the script will also need dependencies added to `scripts/package.json`. Read the current `scripts/package.json` and add `@aws-sdk/client-iam`, `@aws-sdk/client-lambda`, `@aws-sdk/client-api-gateway`, `@aws-sdk/client-cloudformation` (matching the `^3.400.0` / `^3.910.0` pattern of existing entries). Then:

```bash
cd scripts && npm install && cd ..
```

- [ ] **Step 9: Commit**

```bash
git add scripts/setup-availability-2026.js scripts/package.json scripts/package-lock.json
git commit -m "$(cat <<'EOF'
Add scripts/setup-availability-2026.js orchestrator

One-shot AWS CLI/SDK script that provisions all backend resources for
the availability form outside SAM: DynamoDB table
icup-availability-2026-prod, IAM role icup-availability-lambda-role
(narrow DDB + SES policy), two Lambdas (icup-submit-availability +
icup-get-availability), and the /availability API Gateway resource
with POST/GET/OPTIONS methods on the existing PairingsApi. Idempotent
via describe-then-create for every resource; safe to re-run.

Reads the current admin password from
~/.icup-admin-passwords/prod-2026-08-20.txt at run time (never
committed, never echoed). Adds four new AWS SDK client deps to
scripts/package.json.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Run setup script against prod

**STOP-AND-CONFIRM.** Human must approve before this dispatches. Creates real AWS resources (table + IAM role + 2 Lambdas + API route) in the prod account.

**Files:** none modified in git

- [ ] **Step 1: Verify SSO session**

```bash
aws --profile icup_website_user sts get-caller-identity
```

Expect account `792782029232`. If expired: `aws sso login --profile default`, retry.

- [ ] **Step 2: Run the script**

```bash
node scripts/setup-availability-2026.js
```

Expected output (abridged):
```
[identity] account=792782029232 arn=...
=== precheck ===
  [OK] password file present, Lambda dirs present
=== create icup-availability-2026-prod ===
  [OK] created
=== IAM role icup-availability-lambda-role ===
  [OK] role created
  [OK] AWSLambdaBasicExecutionRole attached
  [OK] inline policy set
=== Lambda icup-submit-availability ===
  installing deps in .../lambda/submitAvailability
  creating…
  [OK] created
=== Lambda icup-get-availability ===
  installing deps in .../lambda/getAvailability
  creating…
  [OK] created
=== API Gateway wiring ===
  REST API id: qzq9gvuk9f
  creating /availability resource
  [POST] wiring to icup-submit-availability
  [GET] wiring to icup-get-availability
  [OPTIONS] mock integration for CORS preflight
=== deploy API stage ===
  [OK] deployed to stage prod
=== verify ===
  OPTIONS https://qzq9gvuk9f.execute-api.us-east-1.amazonaws.com/prod/availability → 200
  GET (wrong pw) → 401 (expect 401)
  [OK] endpoint reachable and auth-enforced
[ok] availability setup complete
  POST/GET https://qzq9gvuk9f.execute-api.us-east-1.amazonaws.com/prod/availability
```

Non-zero exit → BLOCKED, do not proceed. Script is idempotent; fix cause and re-run.

- [ ] **Step 3: End-to-end backend test with a real submission**

```bash
ADMIN_PW=$(cat ~/.icup-admin-passwords/prod-2026-08-20.txt)
API_URL=https://qzq9gvuk9f.execute-api.us-east-1.amazonaws.com/prod/availability

# Submit a test RSVP (attending, all three days)
curl -s -X POST "$API_URL" \
    -H "Content-Type: application/json" \
    -d '{"name":"Test Person","email":"erikwagner77+availability-test@gmail.com","attending":true,"pairingsParty":true,"day1":true,"day2":true}'
echo

# Verify row in DDB
aws --profile icup_website_user --region us-east-1 dynamodb scan --table-name icup-availability-2026-prod --output json | jq '.Items | length'

# Fetch via admin GET
curl -s "$API_URL" -H "X-Admin-Password: $ADMIN_PW" | jq '.count'

# Re-submit with different days (upsert test)
curl -s -X POST "$API_URL" \
    -H "Content-Type: application/json" \
    -d '{"name":"Test Person","email":"erikwagner77+availability-test@gmail.com","attending":true,"pairingsParty":false,"day1":true,"day2":false}'
echo
curl -s "$API_URL" -H "X-Admin-Password: $ADMIN_PW" | jq '.items[0] | {email, submissionCount, pairingsParty, day1, day2}'

# Test validation: missing email
curl -s -o /dev/null -w "%{http_code}\n" -X POST "$API_URL" \
    -H "Content-Type: application/json" \
    -d '{"name":"No Email","attending":true}'

# Confirm 3 admin emails + 1 confirmation received — check inboxes.
```

Expected:
- First curl: `{"ok":true,"submissionCount":1,"updated":false}`
- DDB scan: 1 item
- GET (right pw): `1`
- Second curl: `{"ok":true,"submissionCount":2,"updated":true}`
- GET after upsert: shows submissionCount:2, pairingsParty:false, day1:true, day2:false
- Missing-email curl: `400`
- Inboxes: 3 admin emails (BCC — appear individually to each), 1 confirmation to `erikwagner77+availability-test@gmail.com`

- [ ] **Step 4: Clean up test row**

```bash
aws --profile icup_website_user --region us-east-1 dynamodb delete-item \
    --table-name icup-availability-2026-prod \
    --key '{"email":{"S":"erikwagner77+availability-test@gmail.com"}}'
echo "test row deleted"
```

- [ ] **Step 5: Report to human before proceeding to Task 9**

Backend is live but no user-facing HTML has been deployed yet. Next step is pushing the branch to staging.

---

### Task 9: Merge to staging + deploy + frontend browser test

**STOP-AND-CONFIRM** (push to shared branch). Merges the feature branch into `staging`, deploys via GitHub Actions, then browser-verifies the form + admin dashboard against the live prod API.

**Files:** none modified in git

- [ ] **Step 1: Push feature branch**

```bash
git push -u origin feature/availability-form
```

- [ ] **Step 2: Merge into staging**

```bash
git checkout staging
git pull origin staging --ff-only
git merge --no-ff feature/availability-form -m "$(cat <<'EOF'
Merge feature/availability-form: 2026 availability RSVP form

New public form at /availability/, admin dashboard at
/admin/availability.html, both hitting the new
POST/GET /availability endpoints. Backend already provisioned on
prod via scripts/setup-availability-2026.js.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
git push origin staging
git checkout feature/availability-form
```

- [ ] **Step 3: Watch the staging deploy**

```bash
sleep 5
RUN_ID=$(gh run list --branch staging --limit 1 --json databaseId --jq '.[0].databaseId')
echo "watching $RUN_ID"
while true; do
    STATUS=$(gh run view $RUN_ID --json status,conclusion --jq '.status + ":" + (.conclusion // "")')
    echo "$(date +%H:%M:%S) $STATUS"
    case "$STATUS" in
        completed:success) break ;;
        completed:*) echo "FAIL"; exit 1 ;;
    esac
    sleep 20
done
```

- [ ] **Step 4: URL sanity check**

```bash
for u in / /availability/ /admin/availability.html /admin/; do
    code=$(curl -sIo /dev/null -w "%{http_code}" "https://staging.lansdowne-international-cup.com$u")
    echo "$code  $u"
done
```

Expect all 200.

- [ ] **Step 5: Manual browser walk (staging)**

Human opens and eyeballs:

1. `https://staging.lansdowne-international-cup.com/availability/`
   - Form renders. Toggle Yes/No — day checkboxes reveal/hide.
   - Submit with a real test address (e.g. `youraddress+staging1@gmail.com`) → success message; confirmation email arrives; 3 admin emails arrive.
   - Re-submit same email with different days → "updated your RSVP" message.
2. `https://staging.lansdowne-international-cup.com/admin/availability.html`
   - Password prompt → wrong password rejected → right password unlocks.
   - Table shows the test row(s).
   - Filter chips (All / Attending / Declined / Updated) work.
   - CSV export downloads a valid file.
   - Console: no errors.
3. `https://staging.lansdowne-international-cup.com/` — top nav has "RSVP" link, clicking it goes to `/availability/`.
4. `https://staging.lansdowne-international-cup.com/admin/` — menu shows the new "Availability RSVPs" card.

- [ ] **Step 6: Clean up staging test rows via DDB delete-item, same as Task 8 Step 4.**

- [ ] **Step 7: Report to human — request explicit "go" before merging to `main`.**

---

### Task 10: Merge to main + prod deploy + post-launch verification

**STOP-AND-CONFIRM** (production deploy). Merges `staging` into `main`, triggers the prod deploy, verifies public URLs, deletes the feature branch.

**Files:** none modified in git

- [ ] **Step 1: Merge staging into main**

```bash
git checkout main
git pull origin main --ff-only
git merge --ff-only origin/staging
git push origin main
```

Fast-forward should succeed (main hasn't moved since we branched). If not, BLOCKED — someone else pushed; investigate before force-anything.

- [ ] **Step 2: Watch the prod deploy**

```bash
sleep 5
RUN_ID=$(gh run list --branch main --limit 1 --json databaseId --jq '.[0].databaseId')
echo "watching $RUN_ID"
while true; do
    STATUS=$(gh run view $RUN_ID --json status,conclusion --jq '.status + ":" + (.conclusion // "")')
    echo "$(date +%H:%M:%S) $STATUS"
    case "$STATUS" in
        completed:success) break ;;
        completed:*) echo "FAIL"; exit 1 ;;
    esac
    sleep 20
done
```

- [ ] **Step 3: Prod URL sanity**

```bash
for u in / /availability/ /admin/availability.html; do
    code=$(curl -sIo /dev/null -w "%{http_code}" "https://www.lansdowne-international-cup.com$u")
    echo "$code  $u"
done
```

Expect all 200.

- [ ] **Step 4: End-to-end prod smoke test**

Submit one real RSVP via the live form as yourself. Confirm you receive the confirmation email + the 3 admin emails arrive at Ash + Tim (ask them to confirm).

Load `/admin/availability.html` in a browser, unlock with the current admin password, confirm your test row appears.

- [ ] **Step 5: Delete feature branch**

```bash
git branch -d feature/availability-form
git push origin --delete feature/availability-form
```

- [ ] **Step 6: Announce the form URL** to the roster (out of scope for this plan, but noted).

---

## Self-Review Notes

Reviewing the plan against the spec:

- **Spec §4 (data model):** Task 2 (submitAvailability writes the full item), Task 3 (Scan + sort). Table shape codified in setup script Task 7 Step 3. ✓
- **Spec §5 (API + Lambdas):** Task 2 (submit handler), Task 3 (get handler), Task 7 (deploy + wire routes). Header casing tolerance (spec fix) in Task 3 Step 1 code. ✓
- **Spec §6 (frontend):** Task 4 (form), Task 5 (dashboard), Task 6 (surface via nav + menu + workflow). Cache-busting `?v=2026-08-20` on all new assets from day one. ✓
- **Spec §7 (email):** Task 2 Step 1 code implements admin BCC (with SENDER_EMAIL in To) + submitter confirmation with the exact subject/body from the spec. Failure is caught and logged, DDB write is authoritative. ✓
- **Spec §8 (deployment):** Task 7 (setup script) + Task 8 (run + verify). Idempotent per §5-7 of Task 7. ✓
- **Spec §9 (order of ops):** Task order mirrors spec. Tasks 8, 9, 10 are the three STOP-AND-CONFIRM gates. ✓
- **Spec §10 (rollback):** Not represented as its own task; the individual tasks reference rollback in their failure modes. Setup script is idempotent so partial-failure re-run is safe. ✓
- **Spec §11 (testing):** Task 8 Step 3 (backend curl), Task 9 Step 5 (frontend browser walk), Task 10 Step 4 (prod smoke). ✓
- **Spec §12 (prereqs):** Task 8 Step 1 checks SSO; Task 7 Step 2 (`precheck`) verifies password file. ✓
- **Spec §13 (success criteria):** Task 10 Step 3-4 covers all criteria. ✓

**Placeholder scan:** no TBD/TODO markers. Placeholder-shaped strings ("TBA" for venue) exist only inside static site copy, matching the actual site state.

**Type consistency:**
- Env var names used consistently: `AVAILABILITY_TABLE`, `NOTIFY_EMAIL`, `SENDER_EMAIL`, `ADMIN_PASSWORD`.
- Lambda function names used consistently: `icup-submit-availability`, `icup-get-availability`.
- Item field names used consistently across Lambdas + frontend + setup: `email`, `name`, `attending`, `pairingsParty`, `day1`, `day2`, `firstSubmittedAt`, `updatedAt`, `submissionCount`, `userAgent`.
- API URL used consistently in all three JS files that reference it (Task 4, Task 5, and the sample curls in Task 8) — `https://qzq9gvuk9f.execute-api.us-east-1.amazonaws.com/prod/availability`.

**Scope check:** single-plan-sized. Not decomposable.

---
