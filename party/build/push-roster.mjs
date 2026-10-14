#!/usr/bin/env node
// Replaces the website's player roster (icup-players) with this year's 52.
//
// DANGER: updatePlayers DELETES every id not in the list it is given, so this is
// a wholesale replacement. Without --confirm it only READS (GET /players) and
// prints the diff. With --confirm it still writes nothing until the phrase for
// the chosen target has been typed. Run it once, well before the night.
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loadRoster } from './roster.mjs';
import { API_URLS, loadPassword, getPlayers, putPlayers } from '../lib/aws.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DETAILS = resolve(HERE, '../../contacts/player-details.json');
const TEAM_LABEL = { usa: 'USA', international: 'International' };

export function toPlayerItems(roster) {
  return roster.map((p) => {
    const parts = p.name.trim().split(/\s+/);
    const lastName = parts.pop();
    return {
      id: p.id,
      team: TEAM_LABEL[p.team],
      firstName: parts.join(' '),
      lastName,
      nickname: '',
      teeColor: 'Blue',
    };
  });
}

const label = (p) => `${p.firstName} ${p.lastName}`;
// team decides which side a player appears on, so it counts as a difference.
const same = (a, b) => label(a) === label(b) && a.team === b.team && a.teeColor === b.teeColor;
const describe = (p, other) => (p.team === other.team ? label(p) : `${label(p)} [${p.team}]`);

export function rosterDiff(existing, incoming) {
  const before = new Map(existing.map((p) => [p.id, p]));
  const after = new Map(incoming.map((p) => [p.id, p]));
  const added = incoming.filter((p) => !before.has(p.id));
  const removed = existing.filter((p) => !after.has(p.id));
  const changed = incoming.filter((p) => {
    const was = before.get(p.id);
    return was && !same(was, p);
  }).map((p) => ({ ...p, was: describe(before.get(p.id), p), now: describe(p, before.get(p.id)) }));
  return { added, removed, changed };
}

function parseArgs(argv) {
  const args = { target: 'staging', confirm: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--target') args.target = argv[++i];
    else if (argv[i] === '--confirm') args.confirm = true;
  }
  return args;
}

// Resolves to the typed line, or '' if the terminal closes: a closed stdin must
// read as "not confirmed", never hang and never be taken for consent.
async function askOnTerminal(prompt) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await Promise.race([
      rl.question(prompt),
      new Promise((done) => rl.once('close', () => done(''))),
    ]);
  } finally {
    rl.close();
  }
}

// Returns the exit code. Everything it touches is injectable so that a test can
// prove no write is made without ever going near a real endpoint.
export async function runPush({
  argv, roster, fetchImpl = fetch, ask = askOnTerminal,
  getPassword = loadPassword, out = console.log,
}) {
  const args = parseArgs(argv);
  const apiUrl = Object.hasOwn(API_URLS, args.target) ? API_URLS[args.target] : null;
  if (!apiUrl) {
    out(`\n  "${args.target}" is not a target. Use --target staging or --target prod. Nothing was done.\n`);
    return 1;
  }

  const incoming = toPlayerItems(roster ?? loadRoster(DETAILS));
  const existing = await getPlayers({ apiUrl, fetchImpl });
  const d = rosterDiff(existing, incoming);

  out(`\n  Target: ${args.target}  (${apiUrl})`);
  out(`  icup-players currently holds ${existing.length}; this would leave ${incoming.length}.\n`);
  for (const p of d.removed) out(`   - REMOVE  ${p.id.padEnd(18)} ${label(p)}`);
  for (const p of d.added) out(`   + ADD     ${p.id.padEnd(18)} ${label(p)}`);
  for (const p of d.changed) out(`   ~ RENAME  ${p.id.padEnd(18)} ${p.was} -> ${p.now}`);
  if (!d.added.length && !d.removed.length && !d.changed.length) {
    out('   (no change)\n');
    return 0;
  }

  out('\n  updatePlayers DELETES every id not in the list above.');
  out('  Anything already referencing a removed id - old pairings, old results - will');
  out('  render as a blank name afterwards.\n');

  if (!args.confirm) {
    out('  Dry run. Nothing was written. Re-run with --confirm to be asked for the phrase.\n');
    return 0;
  }

  const phrase = `REPLACE-ROSTER-${args.target.toUpperCase()}`;
  const typed = await ask(`  Type ${phrase} to proceed: `);
  if (String(typed).trim() !== phrase) {
    out('\n  Not confirmed. Nothing was written.\n');
    return 1;
  }

  const AGAIN = 'Running it again is safe: it replaces the roster with the same list each time.';
  const password = getPassword({ target: args.target });
  try {
    await putPlayers({ apiUrl, password, players: incoming, fetchImpl });
  } catch (e) {
    out(`\n  [!!] The write may not have finished: ${e.message}`);
    out(`       Check the roster, then run this again. ${AGAIN}\n`);
    return 1;
  }

  // The Lambda can drop a throttled slice without saying so, after it has already
  // deleted. Count what is actually there rather than trusting the write.
  let present;
  try {
    const after = await getPlayers({ apiUrl, fetchImpl });
    const ids = new Set(after.map((p) => p.id));
    present = incoming.filter((p) => ids.has(p.id)).length;
  } catch (e) {
    out(`\n  [!!] The write went through but the roster could not be read back: ${e.message}`);
    out(`       Run the dry run to see where it stands, and this again if anyone is missing. ${AGAIN}\n`);
    return 1;
  }
  if (present === incoming.length) {
    out(`\n  [ok] all ${incoming.length} present\n`);
    return 0;
  }
  out(`\n  [!!] ${present} of ${incoming.length} - run it again. ${AGAIN}\n`);
  return 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await runPush({ argv: process.argv.slice(2) });
  } catch (e) {
    // AwsError and RosterError carry sentences written for a person; nothing
    // else (a stack, a code) is worth showing in a pub.
    console.log(`\n  [!!] ${e.message}\n       Nothing was written.\n`);
    process.exitCode = 1;
  }
}
