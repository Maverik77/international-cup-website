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
