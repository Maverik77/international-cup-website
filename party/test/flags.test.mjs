import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  FLAG_CODES, flagPathFor, FlagError, validatePng, fetchFlags, PNG_SIGNATURE,
} from '../build/fetch-flags.mjs';
import { loadRoster } from '../build/roster.mjs';

const FLAGS_DIR = fileURLToPath(new URL('../assets/flags', import.meta.url));
const REAL = fileURLToPath(new URL('../../contacts/player-details.json', import.meta.url));

test('every country on the real roster has a flag code', {
  skip: !existsSync(REAL) && 'contacts/player-details.json is not present (gitignored)',
}, () => {
  const missing = [...new Set(loadRoster(REAL).map((p) => p.country))]
    .filter((c) => !(c in FLAG_CODES));
  assert.deepEqual(missing, [], `countries with no flag in party/build/flags.json: ${missing.join(', ')}`);
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
