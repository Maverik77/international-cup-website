#!/usr/bin/env node
import { readFileSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHub, parseArgs, bannerLines } from './hub.mjs';
import { indexShow } from './build/build-show.mjs';
import { sessionToken, COOKIE_NAME } from './lib/auth.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REHEARSAL_STATE = 'state.rehearsal.json';

export function rehearsalPlan(show) {
  const plan = [];
  const intl = show.players.filter((p) => p.team === 'international').map((p) => p.id);
  const usa = show.players.filter((p) => p.team === 'usa').map((p) => p.id);

  for (const day of [1, 2]) {
    plan.push({ name: 'setDay', day });
    const slots = show.days[String(day)];
    const n = day === 1 ? 2 : 1;
    slots.forEach((slot, i) => {
      plan.push({ name: 'goto', index: i });
      plan.push({ name: 'assign', side: 'intl', players: intl.slice(i * n, i * n + n) });
      plan.push({ name: 'reveal' });
      plan.push({ name: 'assign', side: 'usa', players: usa.slice(i * n, i * n + n) });
      plan.push({ name: 'reveal' });
      plan.push({ name: 'next' });
    });
  }
  plan.push({ name: 'setMode', mode: 'slideshow' });
  return plan;
}

// The one place a rehearsal hub is made. createHub({ rehearsal: true }) switches
// sync off but does NOT pick a different state file; only parseArgs does. So the
// state path is taken from parseArgs and forced last, and so are the two flags,
// whatever hubOptions says. `dir` re-roots the files for tests; the script never
// passes it. Each rehearsal starts from match 1: the old rehearsal file is
// removed first, and it is only ever the rehearsal file.
export async function startRehearsalHub({ argv = [], dir = HERE, hubOptions = {} } = {}) {
  const args = parseArgs(['--rehearsal', ...argv]);
  if (!args.rehearsal || !args.statePath || basename(args.statePath) !== REHEARSAL_STATE) {
    throw new Error('refusing to rehearse: the rehearsal state file was not selected');
  }
  const statePath = join(dir, REHEARSAL_STATE);
  rmSync(statePath, { force: true });
  return createHub({
    ...args,
    showPath: join(dir, 'show.json'),
    ...hubOptions,
    statePath,
    rehearsal: true,
    enableSync: false,
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function runRehearsal({
  baseUrl, plan, pace = 2, onStep = () => {}, fetchImpl = fetch, headers = {},
}) {
  let sent = 0;
  for (const [i, command] of plan.entries()) {
    let outcome = 'ok';
    try {
      const res = await fetchImpl(`${baseUrl}/api/command`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(command),
      });
      const body = await res.json();
      if (!body.ok) outcome = body.error || 'the hub refused it';
    } catch (e) {
      outcome = e.message;
    }
    sent += 1;
    onStep(i + 1, plan.length, command, outcome);
    if (pace) await sleep(pace * 1000);
  }
  return sent;
}

function readArgs(argv) {
  const args = { pace: 2, hubArgv: [], go: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--pace') args.pace = Number(argv[++i]);
    else if (argv[i] === '--port') args.hubArgv.push('--port', argv[++i]);
    else if (argv[i] === '--go') args.go = true;
  }
  if (!Number.isFinite(args.pace) || args.pace < 0) {
    throw new Error('--pace needs a number of seconds, 0 or more');
  }
  return args;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let hub;
  let args;
  try {
    args = readArgs(process.argv.slice(2));
    hub = await startRehearsalHub({ argv: args.hubArgv });
  } catch (e) {
    console.error(`\n  Could not start the rehearsal: ${e.message}\n`);
    process.exit(1);
  }
  const show = indexShow(JSON.parse(readFileSync(join(HERE, 'show.json'), 'utf8')));
  const port = hub.server.address().port;
  const base = `http://127.0.0.1:${port}`;
  console.log('\n  REHEARSAL. Nothing reaches AWS and party/state.json is untouched.');
  for (const line of bannerLines(hub, { rehearsal: true })) console.log(line);
  console.log(`  Pace       ${args.pace}s per step\n`);
  if (!args.go) {
    console.log('  Open the stage, click once to start it, then press Enter here.');
    const keyed = await new Promise((r) => {
      process.stdin.once('data', () => r(true));
      process.stdin.once('end', () => r(false));
    });
    if (!keyed) {
      console.error('\n  Nothing to read from the keyboard here. Run it again with --go to start straight away.\n');
      await hub.stop();
      process.exit(1);
    }
  }

  const plan = rehearsalPlan(show);
  let refused = 0;
  await runRehearsal({
    baseUrl: base, plan, pace: args.pace,
    headers: { Cookie: `${COOKIE_NAME}=${sessionToken(hub.operatorPassword)}` },
    onStep: (i, total, c, outcome) => {
      if (outcome !== 'ok') refused += 1;
      console.log(`  [${String(i).padStart(3)}/${total}] ${c.name}${outcome === 'ok' ? '' : `  !! ${outcome}`}`);
    },
  });
  console.log(`\n  Rehearsal complete: ${plan.length} steps, ${refused} refused. The stage is now in slideshow.`);
  if (args.go) {
    await hub.stop();
    process.exit(refused ? 1 : 0);
  }
  console.log('  Ctrl-C when you have seen enough.\n');
  const bye = async () => { await hub.stop(); process.exit(0); };
  process.on('SIGINT', bye);
  process.on('SIGTERM', bye);
}
