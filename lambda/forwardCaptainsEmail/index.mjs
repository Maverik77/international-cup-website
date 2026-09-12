import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';

const s3 = new S3Client({});
const ses = new SESv2Client({});

const BUCKET = process.env.INBOUND_BUCKET;
const PREFIX = process.env.INBOUND_PREFIX || 'inbox/';
const FORWARD_FROM = process.env.FORWARD_FROM;
const FORWARD_TO = (process.env.FORWARD_TO || '').split(',').map(s => s.trim()).filter(Boolean);
const LOOP_HEADER = 'X-LIC-Forwarded';

// Headers that must not survive a rewrite: the DKIM signature covers the
// original From, and the SES/envelope headers confuse the receiving MTA.
const STRIP = new Set([
    // The signature covers the original From, which we are about to rewrite.
    'dkim-signature',
    'domainkey-signature',
    'x-ses-dkim-signature',
    // Envelope and trace headers that belong to the inbound hop, not the outbound one.
    'return-path',
    'sender',
    'message-id',
    'received',
    'received-spf',
    'delivered-to',
    'x-original-to',
    'x-originating-ip',
    'authentication-results',
    'arc-authentication-results',
    'arc-message-signature',
    'arc-seal',
    // SES-specific headers. Feedback-ID in particular is tied to the original
    // sending identity, and passing a stale one through gets the forward dropped.
    'feedback-id',
    'x-ses-outgoing',
    'x-ses-spam-verdict',
    'x-ses-virus-verdict',
    'x-ses-spf-verdict',
    'x-ses-dkim-verdict',
    'x-ses-dmarc-verdict',
    'x-ses-receipt',
    // Unsubscribe targets point at the original sender's list, not ours.
    'list-unsubscribe',
    'list-unsubscribe-post'
]);

/**
 * Split a raw MIME message into folded header blocks plus the body.
 * Each block keeps its original line folding so long headers survive intact.
 */
function splitMessage(raw) {
    const sep = raw.indexOf('\r\n\r\n');
    const useCrlf = sep !== -1;
    const idx = useCrlf ? sep : raw.indexOf('\n\n');
    if (idx === -1) return { headers: [], body: raw, eol: '\r\n' };

    const eol = useCrlf ? '\r\n' : '\n';
    const headerText = raw.slice(0, idx);
    const body = raw.slice(idx + eol.length * 2);

    const headers = [];
    for (const line of headerText.split(eol)) {
        if (/^[ \t]/.test(line) && headers.length) {
            headers[headers.length - 1] += eol + line;
        } else {
            headers.push(line);
        }
    }
    return { headers, body, eol };
}

const nameOf = block => block.slice(0, block.indexOf(':')).trim().toLowerCase();
const valueOf = block => block.slice(block.indexOf(':') + 1).trim().replace(/\r?\n[ \t]+/g, ' ');

/** Pull the bare address out of a From header value. */
function bareAddress(value) {
    const angled = value.match(/<([^>]+)>/);
    return (angled ? angled[1] : value).trim().toLowerCase();
}

/**
 * Turn "Tim Pearce <tim@x.com>" into a display name we can reuse.
 *
 * Senders with no display name leave us only their address, and a display name
 * holding an address that differs from the one in the angle brackets is the
 * classic phishing shape - Gmail drops those on the floor without bouncing.
 * So anything address-shaped gets reduced to its local part.
 */
function displayName(value) {
    const angled = value.indexOf('<');
    const raw = angled === -1
        ? value.trim()
        : (value.slice(0, angled).trim().replace(/^"|"$/g, '') || value.slice(angled));
    return raw.replace(/<|>/g, '').replace(/(\S+)@\S+/g, '$1').trim() || 'Unknown sender';
}

function quote(name) {
    return `"${name.replace(/["\\]/g, '\\$&')}"`;
}

function rewrite(raw) {
    const { headers, body, eol } = splitMessage(raw);

    if (headers.some(h => nameOf(h) === LOOP_HEADER.toLowerCase())) return null;

    const fromBlock = headers.find(h => nameOf(h) === 'from');
    const originalFrom = fromBlock ? valueOf(fromBlock) : '';
    if (originalFrom && bareAddress(originalFrom) === FORWARD_FROM.toLowerCase()) return null;

    const replyToBlock = headers.find(h => nameOf(h) === 'reply-to');
    const replyTo = replyToBlock ? valueOf(replyToBlock) : originalFrom;

    const kept = headers.filter(h => {
        const n = nameOf(h);
        return n && n !== 'from' && n !== 'reply-to' && !STRIP.has(n);
    });

    const sender = originalFrom ? displayName(originalFrom) : 'Unknown sender';
    kept.unshift(`From: ${quote(`${sender} via International Cup`)} <${FORWARD_FROM}>`);
    if (replyTo) kept.push(`Reply-To: ${replyTo}`);
    kept.push(`${LOOP_HEADER}: 1`);

    return kept.join(eol) + eol + eol + body;
}

export const handler = async (event) => {
    for (const record of event.Records || []) {
        const messageId = record.ses?.mail?.messageId;
        if (!messageId) continue;

        const key = `${PREFIX}${messageId}`;
        const obj = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
        const raw = await obj.Body.transformToString('utf8');

        const rewritten = rewrite(raw);
        if (!rewritten) {
            console.log(`Skipping ${messageId}: loop guard tripped`);
            continue;
        }

        await ses.send(new SendEmailCommand({
            FromEmailAddress: FORWARD_FROM,
            Destination: { ToAddresses: FORWARD_TO },
            Content: { Raw: { Data: Buffer.from(rewritten, 'utf8') } }
        }));

        console.log(`Forwarded ${messageId} to ${FORWARD_TO.length} captains`);
    }

    return { statusCode: 200 };
};
