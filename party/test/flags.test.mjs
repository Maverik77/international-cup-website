import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  FLAG_CODES, flagPathFor, FlagError, validatePng, fetchFlags, PNG_SIGNATURE, validateCodes,
} from '../build/fetch-flags.mjs';
import { loadRoster } from '../build/roster.mjs';

const FLAGS_DIR = fileURLToPath(new URL('../assets/flags', import.meta.url));
const REAL = fileURLToPath(new URL('../../contacts/player-details.json', import.meta.url));

test('every country on the real roster has a flag code', {
  skip: !existsSync(REAL) && 'contacts/player-details.json is not present (gitignored)',
}, () => {
  const missing = [...new Set(loadRoster(REAL).map((p) => p.country))]
    .filter((c) => !Object.hasOwn(FLAG_CODES, c));
  const shown = missing.map((c) => c || '(empty)');
  assert.deepEqual(missing, [], `countries with no flag in party/build/flags.json: ${shown.join(', ')}`);
});

test('an unmapped country fails by name, not silently', () => {
  assert.throws(() => flagPathFor('Narnia', FLAGS_DIR), (e) =>
    e instanceof FlagError && e.message.includes('Narnia') && e.message.includes('flags.json'));
});

test('an empty or undefined country fails and says it was empty', () => {
  for (const bad of ['', undefined, null, '   ']) {
    assert.throws(() => flagPathFor(bad, FLAGS_DIR), (e) =>
      e instanceof FlagError && /empty|no country/i.test(e.message) && e.message.includes('flags.json'),
    `expected FlagError for ${JSON.stringify(bad)}`);
  }
});

test('inherited object keys are not treated as countries', () => {
  for (const bad of ['constructor', 'toString', '__proto__']) {
    assert.throws(() => flagPathFor(bad, FLAGS_DIR), FlagError);
  }
});

test('a mapped country resolves to <code>.png inside the flags dir', () => {
  assert.equal(flagPathFor('England', '/x/flags'), join('/x/flags', 'gb-eng.png'));
});

test('every mapped flag has been downloaded and is a real PNG', () => {
  for (const country of Object.keys(FLAG_CODES)) {
    const p = flagPathFor(country, FLAGS_DIR);
    assert.ok(existsSync(p), `missing flag for ${country} - run: npm run party:flags`);
    assert.doesNotThrow(() => validatePng(readFileSync(p), p), `${p} is not a valid PNG`);
  }
});

test('validatePng rejects HTML, tiny files and bad signatures', () => {
  const html = Buffer.from('<!doctype html>'.padEnd(5000, ' '));
  assert.throws(() => validatePng(html, 'x.png'), FlagError);
  assert.throws(() => validatePng(Buffer.concat([PNG_SIGNATURE, Buffer.alloc(100)]), 'x.png'), FlagError);
  assert.doesNotThrow(() => validatePng(Buffer.concat([PNG_SIGNATURE, Buffer.alloc(2000)]), 'x.png'));
});

test('fetchFlags refuses an HTML error page served as a 200 (injected fetch, no network)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'flags-'));
  const fakeFetch = async () => ({
    ok: true, status: 200,
    arrayBuffer: async () => Buffer.from('<html>rate limited</html>'.padEnd(5000, ' ')),
  });
  await assert.rejects(fetchFlags(dir, fakeFetch), FlagError);
  assert.equal(existsSync(join(dir, 'in.png')), false, 'bad download must not be left on disk');
});

test('fetchFlags surfaces an HTTP error (injected fetch, no network)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'flags-'));
  const fakeFetch = async () => ({ ok: false, status: 429 });
  await assert.rejects(fetchFlags(dir, fakeFetch), (e) => e instanceof FlagError && e.message.includes('429'));
});

test('a malformed code in the map cannot become a path', () => {
  for (const bad of ['../escape', 'gb/eng', '', 'IN', 'x', undefined]) {
    assert.throws(() => flagPathFor('Testland', FLAGS_DIR, { Testland: bad }), (e) =>
      e instanceof FlagError && e.message.includes('Testland'), `code ${JSON.stringify(bad)}`);
    assert.throws(() => validateCodes({ Testland: bad }), FlagError);
  }
});

test('the real map only contains well-formed codes', () => {
  assert.doesNotThrow(() => validateCodes(FLAG_CODES));
});

test('every .png in the flags directory is referenced by the map (no orphans)', () => {
  const onDisk = readdirSync(FLAGS_DIR).filter((f) => f.endsWith('.png')).sort();
  const mapped = Object.values(FLAG_CODES).map((c) => `${c}.png`).sort();
  assert.deepEqual(onDisk, mapped);
});

test('the size boundary: 1024 bytes fails, 1025 passes', () => {
  assert.throws(() => validatePng(Buffer.concat([PNG_SIGNATURE, Buffer.alloc(1024 - 8)]), 'x'), FlagError);
  assert.doesNotThrow(() => validatePng(Buffer.concat([PNG_SIGNATURE, Buffer.alloc(1025 - 8)]), 'x'));
});

test('an absent ffprobe skips the dimension check and never deletes existing files', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'flags-'));
  const png = Buffer.concat([PNG_SIGNATURE, Buffer.alloc(2000)]);
  for (const code of Object.values(FLAG_CODES)) writeFileSync(join(dir, `${code}.png`), png);
  const noFfprobe = () => ({ error: { code: 'ENOENT' }, status: null });
  const noNetwork = async () => { throw new Error('network must not be used'); };
  const results = await fetchFlags(dir, noNetwork, noFfprobe);
  assert.equal(results.length, Object.keys(FLAG_CODES).length);
  assert.ok(results.every((r) => /ffprobe not installed/.test(r.status)));
  for (const code of Object.values(FLAG_CODES)) {
    assert.deepEqual(readFileSync(join(dir, `${code}.png`)), png);
  }
});

test('ffprobe rejecting a file we did not download does not delete it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'flags-'));
  const png = Buffer.concat([PNG_SIGNATURE, Buffer.alloc(2000)]);
  for (const code of Object.values(FLAG_CODES)) writeFileSync(join(dir, `${code}.png`), png);
  const rejects = () => ({ status: 1, stdout: Buffer.alloc(0) });
  await assert.rejects(fetchFlags(dir, async () => { throw new Error('no network'); }, rejects), FlagError);
  for (const code of Object.values(FLAG_CODES)) assert.ok(existsSync(join(dir, `${code}.png`)));
});
