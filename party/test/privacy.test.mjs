import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

// The repo is public. show.json carries hometown and school for players who
// declined website publication; state.json carries whatever is on screen.
// Neither may ever be committable.
const MUST_BE_IGNORED = [
  'party/show.json',
  'party/state.json',
  'party/state.rehearsal.json',
  'party/cards/seth-4x9.mp4',
];

for (const path of MUST_BE_IGNORED) {
  test(`${path} is gitignored`, () => {
    const r = spawnSync('git', ['check-ignore', '-q', path], { cwd: process.cwd() });
    assert.equal(r.status, 0, `${path} is NOT ignored by .gitignore`);
  });
}

test('the deploy workflow does not copy party/', () => {
  const r = spawnSync('grep', ['-n', 'party', '.github/workflows/deploy.yml']);
  assert.equal(r.stdout.toString(), '', 'deploy.yml references party/ — it must not be deployed');
});
