import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { saveState, loadState } from '../lib/persist.mjs';
import { initialState, reduce } from '../lib/state.mjs';
import { indexShow } from '../build/build-show.mjs';

function makeShow() {
  const players = [{ id: 'player-intl-1', team: 'international', name: 'I1' },
    { id: 'player-usa-1', team: 'usa', name: 'U1' }];
  return indexShow({ built: 'now', players,
    days: { 1: [{ index: 1, intl: ['player-intl-1', ''], usa: ['', ''] }],
      2: [{ index: 1, intl: ['player-intl-1'], usa: [''] }] } });
}
const show = makeShow();
const dirOf = () => mkdtempSync(join(tmpdir(), 'persist-'));
const tmp = () => join(dirOf(), 'state.json');
const files = (path) => readdirSync(dirname(path)).sort();
const corrupt = (path) => files(path).filter((f) => f.startsWith('state.json.corrupt-'));

// Run fn with fs methods temporarily replaced.
function patched(patches, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(patches)) { saved[k] = fs[k]; fs[k] = v; }
  try { return fn(); } finally { for (const k of Object.keys(saved)) fs[k] = saved[k]; }
}

test('a fresh path yields a fresh state, is not a recovery, and creates nothing', () => {
  const path = tmp();
  const r = loadState(path, show);
  assert.equal(r.recovered, false);
  assert.equal(r.reason, null);
  assert.equal(r.state.rev, 0);
  assert.deepEqual(files(path), []);
});

test('round-trips exactly', () => {
  const path = tmp();
  const s = reduce(initialState(show), { name: 'reveal' }, show);
  saveState(path, s);
  const r = loadState(path, show);
  assert.equal(r.recovered, false);
  assert.deepEqual(r.state, s);
});

test('a second save replaces the first', () => {
  const path = tmp();
  const a = initialState(show);
  const b = reduce(a, { name: 'reveal' }, show);
  saveState(path, a);
  saveState(path, b);
  assert.deepEqual(loadState(path, show).state, b);
});

// ---- atomicity ----

test('leaves no .tmp file behind', () => {
  const path = tmp();
  saveState(path, initialState(show));
  saveState(path, initialState(show));
  assert.deepEqual(files(path), ['state.json']);
});

test('a reader never observes a partial or missing file while saves are happening', async () => {
  const path = tmp();
  const done = `${path}.done-marker`;
  const big = (rev) => ({ ...initialState(show), rev, padding: String(rev % 10).repeat(1_000_000) });
  writeFileSync(path, JSON.stringify(big(0))); // the reader needs a file to start from

  // A separate process, so it really runs concurrently with our synchronous saves.
  const reader = `
    const fs = require('fs');
    const [p, done] = process.argv.slice(1);
    let reads = 0, partial = 0, missing = 0, sawNew = new Set();
    let announced = false;
    while (!fs.existsSync(done)) {
      let t;
      try { t = fs.readFileSync(p, 'utf8'); } catch { missing++; continue; }
      reads++;
      try { const o = JSON.parse(t); if (o.padding.length !== 1000000) partial++; sawNew.add(o.rev); }
      catch { partial++; }
      if (!announced) { announced = true; console.log('ready'); }
    }
    console.log(JSON.stringify({ reads, partial, missing, revs: sawNew.size }));
  `;
  const child = spawn(process.execPath, ['-e', reader, path, done], { stdio: ['ignore', 'pipe', 'inherit'] });
  let out = '';
  let ready;
  const readyP = new Promise((r) => { ready = r; });
  child.stdout.on('data', (d) => { out += d; if (out.includes('ready')) ready(); });
  const exited = new Promise((r) => child.on('close', r));
  try {
    await readyP;
    for (let rev = 1; rev <= 60; rev += 1) {
      saveState(path, big(rev));
      await new Promise((r) => setImmediate(r)); // let the reader get its turn
    }
  } finally {
    writeFileSync(done, ''); // always stop the reader, even if a save threw
  }
  await exited;

  const result = JSON.parse(out.trim().split('\n').pop());
  assert.ok(result.reads > 100, `reader only managed ${result.reads} reads`);
  assert.ok(result.revs > 1, 'reader never saw the file change, so it proved nothing');
  assert.equal(result.partial, 0, 'a reader saw a truncated or unparseable state.json');
  assert.equal(result.missing, 0, 'a reader saw state.json vanish');
});

test('if the rename fails, the previous good state.json is intact and the failure is reported', () => {
  const path = tmp();
  const good = reduce(initialState(show), { name: 'reveal' }, show);
  saveState(path, good);
  const before = readFileSync(path, 'utf8');

  const next = reduce(good, { name: 'reveal' }, show);
  assert.throws(() => patched({ renameSync: () => { throw Object.assign(new Error('disk gone'), { code: 'EIO' }); } },
    () => saveState(path, next)), /disk gone/);

  assert.equal(readFileSync(path, 'utf8'), before);
  assert.deepEqual(loadState(path, show).state, good);
  assert.deepEqual(files(path), ['state.json'], 'the failed save left its .tmp behind');
});

test('if writing fails part way, the previous good state.json is intact', () => {
  const path = tmp();
  const good = initialState(show);
  saveState(path, good);
  const before = readFileSync(path, 'utf8');
  const realWrite = fs.writeSync;
  assert.throws(() => patched({ writeSync: (fd, body) => { realWrite(fd, String(body).slice(0, 10)); throw new Error('ENOSPC'); } },
    () => saveState(path, reduce(good, { name: 'reveal' }, show))), /ENOSPC/);
  assert.equal(readFileSync(path, 'utf8'), before);
  assert.deepEqual(files(path), ['state.json']);
});

test('the file is fsynced before the rename, and the directory after it', () => {
  const path = tmp();
  const events = [];
  const open = fs.openSync, sync = fs.fsyncSync, rename = fs.renameSync;
  const names = new Map();
  patched({
    openSync: (p, ...a) => { const fd = open(p, ...a); names.set(fd, p); return fd; },
    fsyncSync: (fd) => { events.push(`fsync ${names.get(fd)}`); return sync(fd); },
    renameSync: (a, b) => { events.push('rename'); return rename(a, b); },
  }, () => saveState(path, initialState(show)));
  assert.deepEqual(events, [`fsync ${path}.tmp`, 'rename', `fsync ${dirname(path)}`]);
});

// ---- garbage ----

function expectRecovery(path, reasonRe) {
  let r;
  assert.doesNotThrow(() => { r = loadState(path, show); });
  assert.equal(r.recovered, true);
  assert.match(r.reason, reasonRe);
  assert.ok(r.reason.length > 20, 'reason should be a sentence a person can act on');
  assert.deepEqual(r.state, initialState(show));
  assert.equal(corrupt(path).length, 1, 'the bad file should be set aside');
  assert.equal(files(path).includes('state.json'), false, 'the bad file should be gone from its path');
  return r;
}

test('a truncated file is set aside and the hub still starts', () => {
  const path = tmp();
  saveState(path, initialState(show));
  const full = readFileSync(path, 'utf8');
  writeFileSync(path, full.slice(0, Math.floor(full.length / 2)));
  expectRecovery(path, /JSON/i);
});

test('the set-aside file keeps the original bytes', () => {
  const path = tmp();
  writeFileSync(path, '{"half');
  expectRecovery(path, /JSON/i);
  assert.equal(readFileSync(join(dirname(path), corrupt(path)[0]), 'utf8'), '{"half');
});

test('valid JSON that is not a state object', () => {
  for (const body of ['{"hello":"world"}', '[]', '42', 'null', '"state"']) {
    const path = tmp();
    writeFileSync(path, body);
    expectRecovery(path, /not a party state/);
  }
});

test('random bytes', () => {
  const path = tmp();
  writeFileSync(path, randomBytes(2048));
  expectRecovery(path, /JSON/i);
});

test('an empty file', () => {
  const path = tmp();
  writeFileSync(path, '');
  expectRecovery(path, /empty/);
});

test('a whitespace-only file', () => {
  const path = tmp();
  writeFileSync(path, ' \n\t  \n');
  expectRecovery(path, /empty/);
});

test('an unrecognised version', () => {
  const path = tmp();
  writeFileSync(path, JSON.stringify({ ...initialState(show), version: 7 }));
  expectRecovery(path, /version 7/);
});

test('slots of the wrong length for the show', () => {
  for (const [day, slots] of [['1', []], ['2', [initialState(show).slots['2'][0], initialState(show).slots['2'][0]]]]) {
    const path = tmp();
    const s = initialState(show);
    s.slots[day] = slots;
    writeFileSync(path, JSON.stringify(s));
    expectRecovery(path, /slot count|does not match/);
  }
});

test('a state with a malformed slot or out-of-range current match', () => {
  const a = initialState(show); a.slots['1'][0].intl = ['only-one'];
  const b = initialState(show); b.current['2'] = 5;
  const c = initialState(show); c.mode = 'party';
  const d = initialState(show); d.slots['1'][0] = null;
  for (const s of [a, b, c, d]) {
    const path = tmp();
    writeFileSync(path, JSON.stringify(s));
    expectRecovery(path, /not a party state/);
  }
});

test('a path that cannot be read as a file still returns', () => {
  const dir = dirOf();
  const path = join(dir, 'state.json');
  fs.mkdirSync(path); // a directory where the file should be
  let r;
  assert.doesNotThrow(() => { r = loadState(path, show); });
  assert.equal(r.recovered, true);
  assert.match(r.reason, /could not be read/);
});

test('a missing history is tolerated', () => {
  const path = tmp();
  const s = initialState(show);
  delete s.history;
  writeFileSync(path, JSON.stringify(s));
  const r = loadState(path, show);
  assert.equal(r.recovered, false);
  assert.deepEqual(r.state.history, []);
});

test('a leftover .tmp from a crash does not disturb load or the next save', () => {
  const path = tmp();
  const good = initialState(show);
  saveState(path, good);
  writeFileSync(`${path}.tmp`, '{"half');
  const r = loadState(path, show);
  assert.equal(r.recovered, false);
  assert.deepEqual(r.state, good);
  saveState(path, reduce(good, { name: 'reveal' }, show));
  assert.deepEqual(files(path), ['state.json']);
});

// ---- evidence ----

test('two recoveries in a row leave two corrupt files, even within the same millisecond', () => {
  const path = tmp();
  const realNow = Date.now;
  Date.now = () => 1_800_000_000_000;
  try {
    writeFileSync(path, 'first garbage');
    expectRecovery(path, /JSON/i);
    writeFileSync(path, 'second garbage');
    assert.equal(loadState(path, show).recovered, true);
    writeFileSync(path, 'third garbage');
    assert.equal(loadState(path, show).recovered, true);
  } finally { Date.now = realNow; }
  const kept = corrupt(path);
  assert.equal(kept.length, 3);
  assert.deepEqual(kept.map((f) => readFileSync(join(dirname(path), f), 'utf8')).sort(),
    ['first garbage', 'second garbage', 'third garbage']);
});

test('a pre-existing corrupt file is never overwritten', () => {
  const path = tmp();
  const realNow = Date.now;
  Date.now = () => 1_800_000_000_000;
  try {
    const stamp = new Date(1_800_000_000_000).toISOString().replace(/[:.]/g, '-');
    writeFileSync(`${path}.corrupt-${stamp}`, 'evidence');
    writeFileSync(path, 'garbage');
    loadState(path, show);
    assert.equal(readFileSync(`${path}.corrupt-${stamp}`, 'utf8'), 'evidence');
  } finally { Date.now = realNow; }
});

test('a filesystem that cannot fsync directories is tolerated, but a real I/O error is not', () => {
  let path;
  const dirFsync = (code) => {
    const sync = fs.fsyncSync, names = new Map(), open = fs.openSync;
    return {
      openSync: (p, ...a) => { const fd = open(p, ...a); names.set(fd, p); return fd; },
      fsyncSync: (fd) => {
        if (names.get(fd) === dirname(path)) throw Object.assign(new Error(`dir ${code}`), { code });
        return sync(fd);
      },
    };
  };
  path = tmp();
  patched(dirFsync('EINVAL'), () => saveState(path, initialState(show)));
  assert.equal(loadState(path, show).recovered, false);
  assert.throws(() => patched(dirFsync('EIO'), () => saveState(path, initialState(show))), /dir EIO/);
});
