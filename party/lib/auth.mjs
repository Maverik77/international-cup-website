// The gate on the operator console. The stage is public by design; this file
// exists only to keep a stranger on the venue wifi from running the show.
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

export const COOKIE_NAME = 'icup_op';
const LABEL = 'icup-operator-v1';

// Short enough to read off a terminal and type on an iPad, long enough that
// 10-tries-then-wait-a-minute makes guessing hopeless: ~24 bits.
const ADJECTIVES = ['amber', 'brave', 'clear', 'dark', 'early', 'first', 'gold', 'high',
  'iron', 'keen', 'last', 'loud', 'north', 'open', 'proud', 'quick', 'red', 'sharp',
  'swift', 'true', 'warm', 'wild', 'wise', 'young'];
const NOUNS = ['anchor', 'badger', 'cedar', 'dragon', 'eagle', 'falcon', 'grove', 'harbour',
  'island', 'jacket', 'kestrel', 'lantern', 'marble', 'needle', 'otter', 'pebble',
  'quarry', 'ribbon', 'saddle', 'thistle', 'umber', 'valley', 'willow', 'yarrow'];

export function generatePassword(rnd = randomInt) {
  const a = ADJECTIVES[rnd(ADJECTIVES.length)];
  const n = NOUNS[rnd(NOUNS.length)];
  return `${a}-${n}-${String(rnd(10, 100))}`;
}

// Returns the password to use, and where it came from. Writes the file only
// when it had to invent one, and never widens its permissions.
export function loadOperatorPassword({ path, explicit = null, generate = generatePassword }) {
  if (typeof explicit === 'string' && explicit.trim() !== '') {
    return { password: explicit.trim(), source: 'explicit' };
  }
  if (existsSync(path)) {
    let text = '';
    try { text = readFileSync(path, 'utf8'); } catch { text = ''; }
    const password = text.trim();
    if (password !== '') return { password, source: 'file' };
    // Present but empty: treat as missing rather than booting with no password.
  }
  const password = generate();
  writeFileSync(path, `${password}\n`, { mode: 0o600 });
  return { password, source: 'generated' };
}

export function sessionToken(password) {
  return createHmac('sha256', String(password)).update(LABEL).digest('hex');
}

// Compares through the HMAC so the buffers are always 32 bytes: timingSafeEqual
// throws on a length mismatch, and a candidate of the wrong length is exactly
// what a guesser sends.
export function checkPassword(given, password) {
  if (typeof given !== 'string' || given === '') return false;
  const a = Buffer.from(sessionToken(given), 'hex');
  const b = Buffer.from(sessionToken(password), 'hex');
  return timingSafeEqual(a, b);
}

export function setCookieHeader(token) {
  // No Secure flag: this is plain http on a LAN, and a Secure cookie would
  // simply never be stored. Max-Age covers the night and the morning after.
  return `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400`;
}

export function tokenFromCookie(cookieHeader) {
  if (typeof cookieHeader !== 'string') return null;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    // Trim before comparing: "a=1; icup_op=x". An exact name match only, so
    // "xicup_op" and "icup_opx" are not us.
    if (part.slice(0, eq).trim() !== COOKIE_NAME) continue;
    const value = part.slice(eq + 1).trim();
    return value === '' ? null : value;
  }
  return null;
}

export function createGate({ password, now = Date.now, maxFailures = 10, lockoutMs = 60000, maxTracked = 1000 }) {
  const token = sessionToken(password);
  const tokenBuf = Buffer.from(token, 'hex');
  // remote address -> { failures, until }
  const tries = new Map();

  const sweep = () => {
    for (const [ip, rec] of tries) if (rec.until <= now() && rec.failures === 0) tries.delete(ip);
    if (tries.size <= maxTracked) return;
    // A flood of addresses must not grow this map without bound; oldest first.
    const excess = tries.size - maxTracked;
    let i = 0;
    for (const ip of tries.keys()) { if (i++ >= excess) break; tries.delete(ip); }
  };

  return {
    token,
    authorized(req) {
      const given = tokenFromCookie(req?.headers?.cookie);
      if (!given || given.length !== token.length) return false;
      let buf;
      try { buf = Buffer.from(given, 'hex'); } catch { return false; }
      if (buf.length !== tokenBuf.length) return false;
      return timingSafeEqual(buf, tokenBuf);
    },
    attempt(ip, given) {
      const key = String(ip || 'unknown');
      const rec = tries.get(key) || { failures: 0, until: 0 };
      if (rec.until > now()) return { ok: false, locked: true };
      if (checkPassword(given, password)) {
        tries.delete(key);
        return { ok: true, locked: false };
      }
      rec.failures += 1;
      if (rec.failures >= maxFailures) { rec.failures = 0; rec.until = now() + lockoutMs; }
      tries.set(key, rec);
      sweep();
      return { ok: false, locked: rec.until > now() };
    },
  };
}
