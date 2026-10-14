// The gate on the operator console. The stage is public by design; this file
// exists only to keep a stranger on the venue wifi from running the show.
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync, chmodSync, existsSync } from 'node:fs';

export const COOKIE_NAME = 'icup_op';
const LABEL = 'icup-operator-v1';

// Short enough to read off a terminal and type on an iPad, long enough that
// 10-tries-then-wait-a-minute makes guessing hopeless: see KEYSPACE below.
const ADJECTIVES = ['amber', 'brave', 'clear', 'dark', 'early', 'first', 'gold', 'high',
  'iron', 'keen', 'last', 'loud', 'north', 'open', 'proud', 'quick', 'red', 'sharp',
  'swift', 'true', 'warm', 'wild', 'wise', 'young'];
const NOUNS = ['anchor', 'badger', 'cedar', 'dragon', 'eagle', 'falcon', 'grove', 'harbour',
  'island', 'jacket', 'kestrel', 'lantern', 'marble', 'needle', 'otter', 'pebble',
  'quarry', 'ribbon', 'saddle', 'thistle', 'umber', 'valley', 'willow', 'yarrow'];

// adjective x noun x a four-digit number (1000-9999 is 9000 values): about 22 bits.
export const KEYSPACE = ADJECTIVES.length * NOUNS.length * 9000;

export function generatePassword(rnd = randomInt) {
  const a = ADJECTIVES[rnd(ADJECTIVES.length)];
  const n = NOUNS[rnd(NOUNS.length)];
  return `${a}-${n}-${String(rnd(1000, 10000))}`;
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
  // mode only applies when the file is created; a blank file already existed.
  chmodSync(path, 0o600);
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

// What this limiter does and does not do. It charges ten guesses a minute per
// remote address. It does not stop an attacker who can bind many addresses on
// the LAN; against that, KEYSPACE is what makes guessing unprofitable. There is
// deliberately no global rate limit or login queue: a bug in one on the night
// would lock the operator out of their own show.
// One address, or a handful, always accumulates to its lockout. An attacker with
// roughly maxTracked real addresses, each spending real guesses, still gets that
// many lockouts' worth of guessing; the keyspace is what makes that unprofitable.
export function createGate({ password, now = Date.now, maxFailures = 10, lockoutMs = 60000, maxTracked = 1000 }) {
  const token = sessionToken(password);
  const tokenBuf = Buffer.from(token, 'hex');
  // remote address -> { failures, until }
  const tries = new Map();

  // A lockout that is still running is never evicted: it is the only brake on a
  // short password, and a flood of fresh addresses must not be able to flush it.
  // `current` is the address whose attempt is being processed. It is never
  // evicted: forgetting the count of the guess you are handling right now means
  // that guess was never counted at all, and one address could guess forever.
  const sweep = (current) => {
    // Expired lockouts. (Records still counting failures have until = 0 and
    // must survive: only a finished lockout, failures reset to 0, is dropped.)
    for (const [ip, rec] of tries) if (ip !== current && rec.until <= now() && rec.failures === 0) tries.delete(ip);
    if (tries.size <= maxTracked) return;
    // Over the cap: evict the records with the fewest failures first, so that
    // forgetting a victim's nine costs an attacker nine real guesses and a flood
    // of one-failure records buys nothing. Locked records are never evicted; if
    // everything left is locked, the map is allowed to exceed maxTracked on
    // purpose: a record is ~100 bytes and lives 60 seconds, and forgetting a
    // lockout is worse than holding a few thousand of them. (Array.sort is
    // stable, so ties go oldest first.)
    const evictable = [...tries].filter(([ip, rec]) => ip !== current && rec.until <= now())
      .sort((x, y) => x[1].failures - y[1].failures);
    for (const [ip] of evictable.slice(0, tries.size - maxTracked)) tries.delete(ip);
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
      sweep(key);
      return { ok: false, locked: rec.until > now() };
    },
  };
}
