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
import { pickLanAddress, localHostName, pickTailnetAddress } from '../lib/net.mjs';
// Only for DEFAULT_PORT, so the fallback URL printed here cannot drift from the
// one the hub actually listens on. hub.mjs only starts a server when it is the
// process entry point, so importing it here is inert.
import { DEFAULT_PORT } from '../hub.mjs';

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
        // The films themselves are checked by validateCards above, with the cards.
        // This line only counts them, and never fails: the draw does not need a
        // single film, so having none is worth saying and is not a reason to call
        // the night off.
        const films = show.players.filter((p) => typeof p.film === 'string' && p.film !== '');
        checks.push({
          name: 'player films',
          ok: true,
          detail: films.length
            ? `${films.length} films, about ${Math.round((films.length * 30) / 60)} minutes a loop`
            : 'none - a screen set to Player films would hold the title card instead',
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

  const tailnet = pickTailnetAddress(interfaces);
  checks.push({
    name: 'tailnet address',
    // Advisory, like the Bonjour name: this is the spare key for a wifi that
    // isolates its clients, not the path the night runs on. Never fail for it.
    ok: true,
    detail: tailnet
      ? `${tailnet.address} - iPad fallback: http://${tailnet.address}:${DEFAULT_PORT}/operator`
      : 'Tailscale is not up - the isolated-wifi fallback is NOT armed (see party/RESUME.md)',
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
      that is client isolation. It looks nothing like a network fault - both
      devices show full bars and working internet and still cannot see each
      other. Two spare keys, in this order:
        1. Tailscale. Turn the VPN on on BOTH devices, then open the tailnet
           address printed above on the iPad. Needs internet on both.
        2. Phone hotspot, both devices. The one that works with no internet
           at all.
  [ ] Plug the laptop into the TV and open /stage. Click it once: that starts
      the show AND takes it truly full screen, with no menu bar and no tabs.
      Afterwards, press f, or move the mouse and use the button top right.
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
