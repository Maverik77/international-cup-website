import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

// Resolve everything from the repo root, never from process.cwd(), so the
// answers are the same wherever the test is launched from.
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

function git(...args) {
  const r = spawnSync('git', args, { cwd: ROOT });
  assert.equal(r.error, undefined, `could not run git: ${r.error}`);
  return r;
}

// The repo is public. show.json carries hometown and school for players who
// declined website publication; state.json carries whatever is on screen.
// Neither may ever be committable.
const MUST_BE_IGNORED = [
  'contacts/player-details.json',
  'party/show.json',
  'party/state.json',
  'party/state.rehearsal.json',
  'party/cards/seth-4x9.mp4',
];

// Atomic writes leave <name>.tmp behind on a crash; Task 6 moves corrupt state
// aside to <name>.corrupt-<timestamp>. Each holds the same private data.
for (const base of ['party/show.json', 'party/state.json', 'party/state.rehearsal.json']) {
  MUST_BE_IGNORED.push(`${base}.tmp`, `${base}.corrupt-2026-10-22T19-00-00-000Z`, `${base}.corrupt-1792695600000`);
}

for (const path of MUST_BE_IGNORED) {
  test(`${path} is gitignored`, () => {
    const r = git('check-ignore', '-q', path);
    // 0 = ignored, 1 = not ignored, 128 = git itself failed.
    assert.equal(r.status, 0, `${path} is NOT ignored by .gitignore (git exit ${r.status})`);
  });
}

// check-ignore says "a rule matches"; it does not say "git is not tracking
// it". A file added with `git add -f` stays tracked despite the rule.
test('no private party file is tracked by git', () => {
  const r = git('ls-files', 'contacts', 'party/show.json', 'party/state.json',
    'party/state.rehearsal.json', 'party/cards');
  assert.equal(r.status, 0, `git ls-files failed: ${r.stderr}`);
  assert.equal(r.stdout.toString(), '', `tracked private files:\n${r.stdout}`);
});

test('the deploy workflow does not copy party/', () => {
  const workflow = join(ROOT, '.github/workflows/deploy.yml');
  assert.ok(existsSync(workflow), `${workflow} not found - this test would check nothing`);
  const r = spawnSync('grep', ['-n', 'party', workflow]);
  // grep: 0 = match found, 1 = no match, 2 = error.
  assert.equal(r.status, 1, `deploy.yml references party/ or grep failed (exit ${r.status}): ${r.stdout}${r.stderr}`);
});

// `aws s3 sync` ignores .gitignore, so the manual deploy script must carry its
// own excludes for anything private.
test('npm run deploy:manual excludes contacts/ and party/', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const script = pkg.scripts?.['deploy:manual'];
  assert.equal(typeof script, 'string', 'package.json has no deploy:manual script');
  for (const dir of ['contacts', 'party']) {
    assert.match(script, new RegExp(`--exclude\\s+['"]${dir}/\\*['"]`),
      `deploy:manual has no --exclude for ${dir}/*`);
  }
});
