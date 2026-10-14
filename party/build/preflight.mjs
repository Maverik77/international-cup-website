#!/usr/bin/env node
// Run the day before, in the venue. Writes nothing, asks nothing, and is safe to
// run at any time. Its job is to fail now rather than on the night.
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { indexShow, validateCards } from './build-show.mjs';
import { toPlayerItems, rosterDiff } from './push-roster.mjs';
import { API_URLS, getPairings, getPlayers } from '../lib/aws.mjs';
import { pickLanAddress, localHostName } from '../lib/net.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PARTY = resolve(HERE, '..');

const oneLine = (s) => String(s).replace(/\s*\n\s*/g, ' ');

export async function preflightChecks({
  partyDir = PARTY, apiUrl = API_URLS.prod, fetchImpl = fetch,
  interfaces = networkInterfaces(), hostRunner, target = 'prod', probe,
} = {}) {
  const checks = [];
  const showPath = join(partyDir, 'show.json');
  let show = null;

  if (!existsSync(showPath)) {
    checks.push({ name: 'show.json', ok: false, detail: `missing at ${showPath} - run: npm run party:build` });
  } else {
    try {
      show = indexShow(JSON.parse(readFileSync(showPath, 'utf8')));
      checks.push({ name: 'show.json', ok: true, detail: `${show.players.length} players${show.built ? `, built ${show.built}` : ''}` });
    } catch {
      show = null;
      checks.push({ name: 'show.json', ok: false, detail: 'unreadable - run: npm run party:build' });
    }
    if (show && !Array.isArray(show.players)) {
      show = null;
      checks[checks.length - 1] = { name: 'show.json', ok: false, detail: 'unreadable - run: npm run party:build' };
    }
    if (show) {
      try {
        const problems = validateCards(show, partyDir, probe ? { probe } : undefined);
        checks.push({
          name: 'cards',
          ok: problems.length === 0,
          detail: problems.length
            ? `${problems.length} problem(s), first: ${oneLine(problems[0])} - run: npm run party:build`
            : 'every card present and the right size',
        });
        const d1 = show.days?.['1'];
        const d2 = show.days?.['2'];
        if (Array.isArray(d1) && Array.isArray(d2)) {
          checks.push({ name: 'running order', ok: d1.length + d2.length === 39, detail: `${d1.length} team + ${d2.length} singles` });
        } else {
          checks.push({ name: 'running order', ok: false, detail: 'show.json has no running order - run: npm run party:build' });
        }
      } catch {
        checks.push({ name: 'cards', ok: false, detail: 'could not be checked - run: npm run party:build' });
      }
    }
  }

  const op = join(partyDir, 'operator-password.txt');
  let opOk = false;
  try { opOk = readFileSync(op, 'utf8').trim() !== ''; } catch { opOk = false; }
  checks.push({
    name: 'operator login',
    ok: opOk,
    // Deliberately reads the file and nothing more: the hub invents one when it is
    // missing, but a check must not write, and the value is never shown.
    detail: opOk ? 'set (the file is there and not empty)' : 'missing or empty - start the hub once (npm run party:start) and it will make one',
  });

  const missingPages = ['operator.html', 'login.html'].filter((f) => !existsSync(join(partyDir, 'private', f)));
  checks.push({
    name: 'operator pages',
    ok: missingPages.length === 0,
    detail: missingPages.length ? `missing party/private/${missingPages.join(', party/private/')} - restore from git` : 'operator.html and login.html present',
  });

  const lan = pickLanAddress(interfaces);
  checks.push({
    name: 'LAN address',
    ok: Boolean(lan),
    detail: lan ? `${lan.iface} ${lan.address}` : 'no routable IPv4 - the iPad will not reach the console',
  });

  const host = hostRunner ? localHostName(hostRunner) : localHostName();
  checks.push({
    name: 'Bonjour name',
    // Advisory: the IP address works without it, so it must not fail the night.
    ok: Boolean(host || lan),
    detail: host || 'no Bonjour name (not needed) - give the iPad the IP address instead',
  });

  if (apiUrl) {
    try {
      const pairings = await getPairings({ apiUrl, fetchImpl });
      checks.push({ name: 'AWS reachable', ok: true, detail: `${pairings.length} pairings in the table` });
    } catch (e) {
      checks.push({ name: 'AWS reachable', ok: false, detail: `${e.message} - the show is unaffected, sync will queue` });
    }

    // The failure this whole push exists to prevent: pairings that name players
    // the website has never heard of render as blanks. Checked against the ids
    // in show.json, which are the ones the pairings will carry.
    if (show) {
      let incoming = null;
      try {
        incoming = toPlayerItems(show.players);
      } catch {
        checks.push({ name: 'roster', ok: false, detail: 'show.json has a player with no name - run: npm run party:build' });
      }
      if (incoming) {
        try {
          const live = await getPlayers({ apiUrl, fetchImpl });
          const d = rosterDiff(live, incoming);
          const bad = d.added.length + d.changed.length;
          checks.push({
            name: 'roster',
            ok: bad === 0,
            detail: bad === 0
              ? `the website knows all ${show.players.length} players`
              : `the ${target} website's roster does not match this show (${d.added.length} missing, ${d.changed.length} changed) - names would show blank. Run: npm run party:push-roster -- --target ${target}`,
          });
        } catch (e) {
          checks.push({ name: 'roster', ok: false, detail: `could not read the website's roster: ${e.message}` });
        }
      }
    }
  }

  return checks;
}

// Everything the command line prints above the hand checklist, so the header
// that says which website was checked can be tested.
export function renderReport(checks, target) {
  return [
    '',
    `Checking the ${target} website  (${API_URLS[target]})`,
    '',
    ...summarise(checks),
  ].map((l) => (l ? `  ${l}` : l));
}

export function summarise(checks) {
  const lines = checks.map((c) => `${c.ok ? '[ok]' : '[!!]'} ${c.name.padEnd(16)} ${oneLine(c.detail)}`);
  const failed = checks.filter((c) => !c.ok);
  lines.push(failed.length === 0
    ? 'READY - every check passed. Now do the hand checks below.'
    : `NOT READY - ${failed.length} check${failed.length === 1 ? '' : 's'} failed: ${failed.map((c) => c.name).join(', ')}.`);
  return lines;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const i = process.argv.indexOf('--target');
    const target = i >= 0 ? process.argv[i + 1] : 'prod';
    if (!Object.hasOwn(API_URLS, target)) {
      console.log(`\n  "${target}" is not a target. Use --target prod or --target staging.\n`);
      process.exit(1);
    }
    const checks = await preflightChecks({ apiUrl: API_URLS[target], target });
    for (const l of renderReport(checks, target)) console.log(l);

    console.log(`
  Do these by hand, here, in the venue, before the night:

  [ ] Open /operator on the iPad over the venue wifi. If it will not load,
      that is client isolation: switch both devices to the phone hotspot.
      It looks nothing like a network fault - both devices show full bars
      and working internet and still cannot see each other.
  [ ] Plug the laptop into the TV and run /stage full screen. Click it once.
  [ ] iPad: Auto-Lock to Never.
  [ ] Laptop: sleep disabled on AC power.
  [ ] Laptop: Do Not Disturb on.
  `);

    if (checks.some((c) => !c.ok)) process.exit(1);

  } catch {
    console.log('\n  [!!] The pre-flight itself broke. Run it again; if it does, run: npm run party:build\n');
    process.exit(1);
  }
}
