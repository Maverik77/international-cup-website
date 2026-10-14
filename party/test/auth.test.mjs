import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  COOKIE_NAME, generatePassword, loadOperatorPassword, sessionToken, checkPassword,
  tokenFromCookie, createGate, KEYSPACE,
} from '../lib/auth.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'auth-'));

test('1: an explicit password is trimmed, used, and never written to disk', () => {
  const path = join(tmp(), 'pw.txt');
  const r = loadOperatorPassword({ path, explicit: '  hunter2  ' });
  assert.deepEqual(r, { password: 'hunter2', source: 'explicit' });
  assert.equal(existsSync(path), false);
});

test('2: a password file is read and trimmed', () => {
  const path = join(tmp(), 'pw.txt');
  writeFileSync(path, 'amber-otter-42\n');
  assert.deepEqual(loadOperatorPassword({ path }), { password: 'amber-otter-42', source: 'file' });
});

test('3: a missing file is generated at 0600, and a restart gets the same password', () => {
  const path = join(tmp(), 'pw.txt');
  const first = loadOperatorPassword({ path });
  assert.equal(first.source, 'generated');
  assert.ok(existsSync(path));
  assert.equal(statSync(path).mode & 0o777, 0o600);
  const second = loadOperatorPassword({ path });
  assert.equal(second.source, 'file');
  assert.equal(second.password, first.password);
});

test('4: a blank file is regenerated, never booted as an empty password', () => {
  const path = join(tmp(), 'pw.txt');
  writeFileSync(path, '   \n');
  chmodSync(path, 0o644);
  const r = loadOperatorPassword({ path });
  assert.equal(r.source, 'generated');
  assert.notEqual(r.password, '');
  assert.equal(readFileSync(path, 'utf8').trim(), r.password);
  assert.equal(statSync(path).mode & 0o777, 0o600, 'regeneration tightens a loose file too');
});

test('5: generated passwords are typeable and varied', () => {
  assert.match(generatePassword(), /^[a-z]+-[a-z]+-\d{4}$/);
  const seen = new Set();
  for (let i = 0; i < 200; i++) seen.add(generatePassword());
  assert.ok(seen.size > 150, `only ${seen.size} distinct of 200`);
});

test('6: sessionToken is 64 hex chars, stable, and password-specific', () => {
  assert.match(sessionToken('a'), /^[0-9a-f]{64}$/);
  assert.equal(sessionToken('a'), sessionToken('a'));
  assert.notEqual(sessionToken('a'), sessionToken('b'));
});

test('7: checkPassword accepts only the exact password and never throws on odd lengths', () => {
  const pw = 'amber-otter-42';
  assert.equal(checkPassword(pw, pw), true);
  for (const bad of ['wrong', '', undefined, null, 42, 'amber-otter-4', `${pw} `]) {
    assert.equal(checkPassword(bad, pw), false, `${String(bad)} must be refused`);
  }
});

test('8: tokenFromCookie matches the exact cookie name only', () => {
  assert.equal(COOKIE_NAME, 'icup_op');
  assert.equal(tokenFromCookie('a=1; icup_op=abc; b=2'), 'abc');
  assert.equal(tokenFromCookie('a=1'), null);
  assert.equal(tokenFromCookie(undefined), null);
  assert.equal(tokenFromCookie('icup_op='), null);
  assert.equal(tokenFromCookie('xicup_op=abc'), null);
  assert.equal(tokenFromCookie('icup_opx=abc'), null);
});

test('9: ten wrong tries lock that address only, until the clock moves past the lockout', () => {
  let clock = 1_000_000;
  const gate = createGate({ password: 'p', now: () => clock, lockoutMs: 60000 });
  for (let i = 0; i < 10; i++) gate.attempt('1.1.1.1', 'nope');
  assert.deepEqual(gate.attempt('1.1.1.1', 'p'), { ok: false, locked: true });
  assert.equal(gate.attempt('2.2.2.2', 'p').ok, true);
  clock += 60001;
  assert.equal(gate.attempt('1.1.1.1', 'p').ok, true);
});

test('10: a success clears the failure count', () => {
  const gate = createGate({ password: 'p', now: () => 1 });
  for (let i = 0; i < 9; i++) gate.attempt('1.1.1.1', 'nope');
  assert.equal(gate.attempt('1.1.1.1', 'p').ok, true);
  for (let i = 0; i < 9; i++) assert.equal(gate.attempt('1.1.1.1', 'nope').locked, false);
  assert.equal(gate.attempt('1.1.1.1', 'p').ok, true, 'still not locked after 9 more');
});

test('11: a flood of fresh addresses cannot flush a running lockout', () => {
  let clock = 1_000_000;
  const gate = createGate({ password: 'p', now: () => clock, maxTracked: 2, lockoutMs: 60000 });
  for (let i = 0; i < 10; i++) gate.attempt('1.1.1.1', 'nope');
  for (let i = 0; i < 5; i++) gate.attempt(`2.2.2.${i}`, 'nope');
  assert.deepEqual(gate.attempt('1.1.1.1', 'p'), { ok: false, locked: true }, 'still locked after the flood');
  clock += 60001;
  assert.equal(gate.attempt('1.1.1.1', 'p').ok, true, 'and unlocks once the window passes');
});

test('11b: the tracking map is bounded - a lone failure is forgotten, oldest first', () => {
  const gate = createGate({ password: 'p', now: () => 1, maxTracked: 2 });
  gate.attempt('1.1.1.1', 'nope');
  for (let i = 0; i < 5; i++) gate.attempt(`2.2.2.${i}`, 'nope');
  // 1.1.1.1 was evicted, so its count restarted: 9 more is its 9th failure, not its 10th.
  for (let i = 0; i < 9; i++) assert.equal(gate.attempt('1.1.1.1', 'nope').locked, false);
});

test('11c: a flood cannot reset a partial failure count - evicting a nine costs nine guesses', () => {
  const gate = createGate({ password: 'p', now: () => 1, maxTracked: 2 });
  for (let i = 0; i < 9; i++) gate.attempt('1.1.1.1', 'nope');
  for (let i = 0; i < 10; i++) gate.attempt(`2.2.2.${i}`, 'nope');
  assert.equal(gate.attempt('1.1.1.1', 'nope').locked, true, 'its tenth failure still locks it');
});

test('KEYSPACE is at least 5 million and is the product of the real word lists', () => {
  assert.ok(KEYSPACE >= 5_000_000, `keyspace is only ${KEYSPACE}`);
  // 24 adjectives x 24 nouns x 9000 four-digit numbers; shrinking a list must fail here.
  assert.equal(KEYSPACE, 24 * 24 * 9000);
  const seen = new Set();
  for (let i = 0; i < 20000; i++) seen.add(generatePassword().split('-').slice(0, 2).join('-'));
  assert.equal(seen.size, 24 * 24, 'every adjective-noun pair is reachable');
});

test('12: authorized accepts only the gate\'s own token', () => {
  const gate = createGate({ password: 'p' });
  const req = (cookie) => ({ headers: cookie === undefined ? {} : { cookie } });
  assert.equal(gate.authorized(req(`${COOKIE_NAME}=${gate.token}`)), true);
  assert.equal(gate.authorized(req()), false);
  assert.equal(gate.authorized(req(`${COOKIE_NAME}=${'z'.repeat(64)}`)), false);
  assert.equal(gate.authorized(req(`${COOKIE_NAME}=${gate.token.slice(0, 40)}`)), false);
  assert.equal(gate.authorized(req(`${COOKIE_NAME}=${sessionToken('other')}`)), false);
});
