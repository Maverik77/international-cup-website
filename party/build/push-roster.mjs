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

export function rosterDiff(existing, incoming) {
  const before = new Map(existing.map((p) => [p.id, p]));
  const after = new Map(incoming.map((p) => [p.id, p]));
  const added = incoming.filter((p) => !before.has(p.id));
  const removed = existing.filter((p) => !after.has(p.id));
  const changed = incoming.filter((p) => {
    const was = before.get(p.id);
    return was && label(was) !== label(p);
  }).map((p) => ({ ...p, was: label(before.get(p.id)) }));
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
  for (const p of d.changed) out(`   ~ RENAME  ${p.id.padEnd(18)} ${p.was} -> ${label(p)}`);
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

  await putPlayers({ apiUrl, password: getPassword({ target: args.target }), players: incoming, fetchImpl });
  const after = await getPlayers({ apiUrl, fetchImpl });
  out(`\n  [ok] icup-players now holds ${after.length} players.\n`);
  return 0;
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
