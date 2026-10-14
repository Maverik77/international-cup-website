#!/usr/bin/env node
// The hub: one Node process holding the show state, serving the stage and the
// operator console, streaming state to them, and taking commands.
// Zero npm dependencies. If this process dies the show stops, so nothing a
// browser (or anything else on the LAN) sends may be able to throw out of a
// request handler.
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { indexShow } from './build/build-show.mjs';
import { loadState, saveState } from './lib/persist.mjs';
import { reduce, project, CommandError } from './lib/state.mjs';
import { createOutbox } from './lib/outbox.mjs';
import { createSseHub } from './lib/sse.mjs';
import { safeJoin, serveFile } from './lib/static.mjs';
import { pickLanAddress, localHostName, operatorUrls, qrLines, qrSvg } from './lib/net.mjs';
import { loadOperatorPassword, createGate, setCookieHeader } from './lib/auth.mjs';
import { API_URLS, AwsError, loadPassword, putPairings, getPairings } from './lib/aws.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_PORT = 8722;
export const MAX_BODY_BYTES = 16 * 1024; // a command is a few dozen bytes

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function landingHtml({ svg, ipUrl, mdnsUrl, stageUrl }) {
  return `<!doctype html><html><head><meta charset="utf-8">
<title>International Cup - pairings party</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
 :root { color-scheme: dark; }
 body { margin:0; min-height:100vh; display:grid; place-items:center; gap:1.5rem;
        background:#0b0d10; color:#f2f3f5; font:16px/1.5 -apple-system,BlinkMacSystemFont,sans-serif;
        padding:2rem; text-align:center; }
 h1 { font-size:1.1rem; letter-spacing:.14em; text-transform:uppercase; color:#FEB619; margin:0; }
 .qr { background:#fff; padding:14px; border-radius:12px; line-height:0; }
 a { color:#f2f3f5; font-size:1.6rem; font-weight:700; text-decoration:none; word-break:break-all; }
 .alt { font-size:1rem; color:#9aa2ad; }
 .alt a { font-size:1rem; font-weight:400; }
</style></head><body>
<h1>Operator console</h1>
<div class="qr">${svg}</div>
<a href="${esc(ipUrl || '/operator')}">${esc(ipUrl || '/operator')}</a>
${mdnsUrl ? `<p class="alt">or, if the address changes: <a href="${esc(mdnsUrl)}">${esc(mdnsUrl)}</a></p>` : ''}
<p class="alt">Stage: <a href="${esc(stageUrl)}">${esc(stageUrl)}</a></p>
</body></html>`;
}

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };

function sendJson(res, code, body, extra = {}) {
  if (res.headersSent) { res.destroy(); return; }
  res.writeHead(code, { ...JSON_HEADERS, ...extra });
  res.end(JSON.stringify(body));
}

// REHEARSAL WARNING: createHub({ rehearsal: true }) turns sync off and flags the
// state, but it does NOT choose a different state file. Only parseArgs()
// (--rehearsal) points statePath at state.rehearsal.json. Any caller that
// rehearses must go through parseArgs or pass statePath explicitly, or the
// rehearsal will overwrite the live state.json.
export async function createHub({
  showPath = join(HERE, 'show.json'),
  statePath = join(HERE, 'state.json'),
  cardsDir = join(HERE, 'cards'),
  publicDir = join(HERE, 'public'),
  privateDir = join(HERE, 'private'), // pages that need the gate; the static handler never reaches here
  port = DEFAULT_PORT,
  target = 'prod',
  enableSync = true,
  rehearsal = false,
  fetchImpl = fetch,
  password = null,
  operatorPassword = null, // tests only: there is deliberately no CLI flag (argv shows in ps)
  operatorPasswordPath = join(HERE, 'operator-password.txt'),
  syncMinDelay = 1000,
  quiet = false,
  loadPasswordImpl = loadPassword, // test seam: pins the no-password-file behaviour deterministically
  reduceImpl = reduce, // test seam: lets a test inject a programming fault
} = {}) {
  const warn = (...a) => { if (!quiet) console.warn(...a); };

  if (!existsSync(showPath)) {
    throw new Error(`${showPath} is missing. Run: npm run party:build`);
  }
  // byId is non-enumerable and does not survive JSON.parse: index exactly once,
  // here, before anything touches the show.
  const show = indexShow(JSON.parse(readFileSync(showPath, 'utf8')));

  const loaded = loadState(statePath, show);
  if (loaded.recovered) {
    warn(`\n  !! previous state set aside. ${loaded.reason}\n`);
  }
  let state = { ...loaded.state, rehearsal };

  const sse = createSseHub();
  const apiUrl = Object.hasOwn(API_URLS, target) ? API_URLS[target] : null;
  if (!apiUrl) throw new Error(`unknown target "${target}" - use prod or staging`);

  // The password goes to putPairings and nowhere else. Never logged, never in
  // an error, never in state, never in whoami.
  // A rehearsal must never reach AWS, whatever else was asked for.
  let syncEnabled = enableSync && !rehearsal;
  let syncNote = null;
  let secret = null;
  if (syncEnabled) {
    try {
      secret = password ?? loadPasswordImpl({ target });
    } catch (e) {
      // The show must go on without the website; say so where the operator looks.
      syncEnabled = false;
      syncNote = `Website sync is off: ${e instanceof AwsError ? e.message : 'no admin password available'}`;
      warn(`\n  !! ${syncNote}\n`);
    }
  }

  // The operator console's own password. Unrelated to the website's admin
  // password above; this one only gates this server's own console.
  const operator = loadOperatorPassword({ path: operatorPasswordPath, explicit: operatorPassword });
  const gate = createGate({ password: operator.password });

  const outbox = createOutbox({
    enabled: syncEnabled,
    minDelay: syncMinDelay,
    getState: () => state,
    push: (items) => putPairings({ apiUrl, password: secret, items, fetchImpl }),
    onStatus: (sync) => { apply({ name: 'setSync', sync }); },
  });

  // What the surfaces need and nothing more. hometown and school are printed
  // inside the cards' final frame (pixels); no surface reads them as data, and
  // this server is reachable by everyone on the venue wifi. show.json on disk
  // keeps them: the build needs them.
  const publicShow = {
    ...show,
    players: show.players.map(({ hometown: _h, school: _s, ...rest }) => rest),
  };

  const wireState = () => project(state, show);

  function persist() {
    try {
      saveState(statePath, state);
    } catch (e) {
      // A failed local write is bad, but stopping the show over it is worse.
      warn(`  !! could not write ${statePath}: ${e?.code || e?.message}`);
    }
  }

  function apply(command) {
    const next = reduceImpl(state, command, show);
    if (next === state) return wireState();
    state = next;
    const wire = wireState();
    // Pixels first; the disk write must never be in front of the screen.
    sse.broadcast('state', wire);
    persist();
    if (command.name !== 'setSync') outbox.markDirty();
    return wire;
  }

  // Pull any draw already on the website into slots that are still empty.
  async function refreshFromAws() {
    const items = await getPairings({ apiUrl, fetchImpl });
    const next = JSON.parse(JSON.stringify(state));
    let filled = 0;
    for (const item of items) {
      // Outside data: never index with an attacker-chosen key ("__proto__",
      // "constructor") and never assume the shape.
      if (!item || typeof item !== 'object') continue;
      const day = String(item.day);
      if (day !== '1' && day !== '2') continue;
      const slot = (next.slots[day] || []).find((s) => s.index === item.match_number);
      if (!slot || slot.done || slot.shown !== 'none') continue;
      const team = item.type === 'team';
      const sides = {
        intl: team ? [item.intl_team?.player1_id || '', item.intl_team?.player2_id || ''] : [item.intl_player_id || ''],
        usa: team ? [item.usa_team?.player1_id || '', item.usa_team?.player2_id || ''] : [item.usa_player_id || ''],
      };
      for (const side of ['intl', 'usa']) {
        const ids = sides[side];
        if (ids.length !== slot[side].length || ids.every((id) => !id)) continue;
        if (slot[side].some(Boolean)) continue;
        const wantTeam = side === 'intl' ? 'international' : 'usa';
        const known = ids.every((id) => !id || (typeof id === 'string' && Object.hasOwn(show.byId, id) && show.byId[id].team === wantTeam));
        if (!known) continue;
        slot[side] = ids;
        filled += 1;
      }
    }
    if (filled) {
      next.rev = state.rev + 1;
      state = next;
      sse.broadcast('state', wireState());
      persist();
    }
    return filled;
  }

  // Reads at most MAX_BODY_BYTES. Resolves to a string, or throws { code: 413 }.
  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let total = 0;
      let done = false;
      const finish = (fn, v) => { if (!done) { done = true; fn(v); } };
      req.on('data', (c) => {
        total += c.length;
        if (total > MAX_BODY_BYTES) { finish(reject, Object.assign(new Error('too large'), { tooLarge: true })); return; }
        chunks.push(c);
      });
      req.on('end', () => finish(resolve, Buffer.concat(chunks).toString('utf8')));
      req.on('error', (e) => finish(reject, e));
      req.on('aborted', () => finish(reject, new Error('aborted')));
      req.on('close', () => finish(reject, new Error('closed')));
    });
  }

  // Shared by /api/command and /api/login: the same CSRF, content-type and
  // size rules. Resolves to the raw body, or null after answering the client.
  async function readJsonPost(req, res, tooLargeMsg) {
    // CSRF: a web page on someone else's tab can POST text/plain at a LAN
    // address without a preflight. Requiring JSON forces a preflight we never
    // answer, and a foreign Origin is refused outright.
    const origin = req.headers.origin;
    if (origin) {
      let originHost = null;
      try { originHost = new URL(origin).host; } catch { /* malformed */ }
      if (originHost !== req.headers.host) {
        sendJson(res, 403, { ok: false, error: 'That request came from another website, so it was refused.' });
        req.resume();
        return null;
      }
    }
    const ctype = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (ctype !== 'application/json') {
      sendJson(res, 415, { ok: false, error: 'Commands must be sent as application/json.' });
      req.resume();
      return null;
    }
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      sendJson(res, 413, { ok: false, error: tooLargeMsg }, { Connection: 'close' });
      res.on('finish', () => req.destroy());
      return null;
    }
    try {
      return await readBody(req);
    } catch (e) {
      if (e.tooLarge) {
        sendJson(res, 413, { ok: false, error: tooLargeMsg }, { Connection: 'close' });
        res.on('finish', () => req.destroy());
      }
      return null; // client went away: nobody to answer
    }
  }

  // Every gated route answers a missing or wrong cookie with exactly this; the
  // console keys on needPassword to send the operator back to the login page.
  function denyUnsigned(res) {
    sendJson(res, 401, { ok: false, needPassword: true, error: 'The console is not signed in. Reload this page and type the password.' });
  }

  async function handleLogin(req, res) {
    const body = await readJsonPost(req, res, 'That is far too large to be a password.');
    if (body === null) return;
    let given = null;
    try { given = JSON.parse(body)?.password; } catch { /* handled below */ }
    if (typeof given !== 'string') {
      sendJson(res, 400, { ok: false, error: 'Type the password and press Unlock.' });
      return;
    }
    // The submitted password is never logged and never echoed.
    const result = gate.attempt(req.socket.remoteAddress, given);
    if (result.locked) {
      sendJson(res, 429, { ok: false, error: 'Too many wrong tries from this device. Wait a minute, then try again.' });
    } else if (!result.ok) {
      sendJson(res, 401, { ok: false, error: 'That is not the password.' });
    } else {
      sendJson(res, 200, { ok: true }, { 'Set-Cookie': setCookieHeader(gate.token) });
    }
  }

  async function handleCommand(req, res) {
    // The gate sits in front of everything, the reducer included.
    if (!gate.authorized(req)) { denyUnsigned(res); req.resume(); return; }
    const body = await readJsonPost(req, res, 'That command is far too large.');
    if (body === null) return;

    let command;
    try {
      command = JSON.parse(body === '' ? 'null' : body);
    } catch {
      sendJson(res, 400, { ok: false, error: 'The console sent something that is not JSON. Reload the console and try again.' });
      return;
    }

    try {
      if (command && typeof command === 'object' && command.name === 'refreshFromAws') {
        const filled = await refreshFromAws();
        sendJson(res, 200, { ok: true, filled, state: wireState() });
        return;
      }
      const wire = apply(command);
      sendJson(res, 200, { ok: true, state: wire });
    } catch (e) {
      if (e instanceof CommandError) {
        sendJson(res, 400, { ok: false, error: e.message });
      } else if (e instanceof AwsError) {
        // Route + status code only, by construction (see aws.mjs).
        sendJson(res, 502, { ok: false, error: `The website could not be reached: ${e.message}` });
      } else {
        // A programming fault, not operator input. Say so; do not dress it up.
        warn(`  !! internal error handling a command: ${e?.stack || e}`);
        sendJson(res, 500, { ok: false, error: 'The hub hit an internal fault. Check the terminal it is running in.' });
      }
    }
  }

  async function route(req, res) {
    const url = (req.url || '/').split(/[?#]/)[0];
    const method = req.method;

    if (url === '/api/command') {
      if (method !== 'POST') { sendJson(res, 405, { ok: false, error: 'POST only' }, { Allow: 'POST' }); return; }
      await handleCommand(req, res);
      return;
    }

    if (url === '/api/login') {
      if (method !== 'POST') { sendJson(res, 405, { ok: false, error: 'POST only' }, { Allow: 'POST' }); return; }
      await handleLogin(req, res);
      return;
    }

    if (method !== 'GET' && method !== 'HEAD') {
      sendJson(res, 405, { ok: false, error: 'GET only' }, { Allow: 'GET, HEAD' });
      return;
    }

    if (url === '/events') {
      sse.attach(req, res);
      sse.sendTo(res, 'state', wireState());
      return;
    }
    if (url === '/api/state') { sendJson(res, 200, wireState()); return; }
    if (url === '/api/show') { sendJson(res, 200, publicShow); return; }
    if (url === '/api/whoami') {
      if (!gate.authorized(req)) { denyUnsigned(res); return; }
      sendJson(res, 200, whoami());
      return;
    }

    if (url === '/') {
      const who = whoami();
      const svg = qrSvg(who.operatorUrl || `http://localhost:${who.port}/operator`, 6);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(landingHtml({ svg, ipUrl: who.operatorUrl, mdnsUrl: who.mdnsUrl, stageUrl: who.stageUrl }));
      return;
    }

    // No redirect: the QR code points at /operator and must keep working.
    // The pages live in privateDir, which the static handler below cannot reach,
    // so no spelling of the URL (percent-encoding, case, trailing slash) can
    // serve the console around this check.
    if (url === '/operator') {
      serveFile(req, res, join(privateDir, gate.authorized(req) ? 'operator.html' : 'login.html'));
      return;
    }
    if (url === '/stage') {
      serveFile(req, res, join(publicDir, 'stage.html'));
      return;
    }

    const root = url.startsWith('/cards/') ? cardsDir : publicDir;
    const rel = url.startsWith('/cards/') ? url.slice('/cards'.length) : url;
    const abs = safeJoin(root, rel);
    if (!abs) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('forbidden');
      return;
    }
    serveFile(req, res, abs);
  }

  const server = createServer((req, res) => {
    route(req, res).catch((e) => {
      warn(`  !! internal error serving ${req.method} ${String(req.url).slice(0, 80)}: ${e?.stack || e}`);
      try { sendJson(res, 500, { ok: false, error: 'internal error' }); } catch { try { res.destroy(); } catch { /* gone */ } }
    });
  });
  server.on('clientError', (_err, socket) => {
    try { if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); else socket.destroy(); } catch { /* gone */ }
  });

  function whoami() {
    const lan = pickLanAddress(networkInterfaces());
    const hostName = localHostName();
    const actualPort = server.address()?.port ?? port;
    const urls = operatorUrls({ address: lan?.address, hostName, port: actualPort });
    return {
      port: actualPort,
      iface: lan?.iface || null,
      address: lan?.address || null,
      hostName,
      operatorUrl: urls.ip,
      mdnsUrl: urls.mdns,
      stageUrl: `http://localhost:${actualPort}/stage`,
      clients: sse.count(),
      rehearsal,
      sync: syncEnabled ? target : 'off',
      syncNote,
      // Set when a saved state file was unusable and the show started fresh.
      recovered: loaded.recovered,
      recoveredReason: loaded.reason,
    };
  }

  await new Promise((ok, fail) => {
    server.once('error', (e) => {
      fail(e?.code === 'EADDRINUSE'
        ? new Error(`Port ${port} is already in use - is another hub running? Stop it, or start this one with --port <number>.`)
        : e);
    });
    server.listen(port, '0.0.0.0', ok);
  });
  server.on('error', (e) => warn(`  !! server error: ${e?.code || e?.message}`));

  const actualPort = server.address().port;

  return {
    server,
    url: `http://localhost:${actualPort}`,
    addresses: (() => {
      const lan = pickLanAddress(networkInterfaces());
      return { lan: lan?.address || null, port: actualPort };
    })(),
    whoami,
    // For the boot banner and the tests. Never part of whoami(): that is a route response.
    operatorPassword: operator.password,
    operatorPasswordSource: operator.source,
    get state() { return state; },
    async stop() {
      outbox.stop();
      sse.closeAll();
      await new Promise((ok) => {
        server.close(() => ok());
        server.closeAllConnections?.();
      });
    },
  };
}

export function parseArgs(argv) {
  const args = { port: DEFAULT_PORT, target: 'prod', enableSync: true, rehearsal: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--port') args.port = Number(argv[++i]);
    else if (argv[i] === '--target') args.target = argv[++i];
    else if (argv[i] === '--no-sync') args.enableSync = false;
    else if (argv[i] === '--rehearsal') { args.rehearsal = true; args.enableSync = false; }
  }
  if (!Number.isInteger(args.port) || args.port < 0 || args.port > 65535) {
    throw new Error('--port needs a number from 0 to 65535');
  }
  if (args.rehearsal) args.statePath = join(HERE, 'state.rehearsal.json');
  return args;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let hub;
  try {
    const args = parseArgs(process.argv.slice(2));
    hub = await createHub({ ...args, quiet: false });
    const who = hub.whoami();
    const operator = who.operatorUrl || `http://localhost:${who.port}/operator`;
    console.log('');
    for (const line of qrLines(operator)) console.log(`  ${line}`);
    console.log('');
    console.log(`  Operator   ${operator}`);
    if (who.mdnsUrl) console.log(`  or         ${who.mdnsUrl}`);
    console.log(`  Stage      ${who.stageUrl}`);
    console.log(`  Password   ${hub.operatorPassword}`);
    if (hub.operatorPasswordSource === 'generated') console.log('             (new - saved in party/operator-password.txt)');
    console.log(`  Landing    http://localhost:${who.port}/`);
    console.log(`  Sync       ${who.sync}${args.rehearsal ? '  (REHEARSAL - nothing reaches AWS)' : ''}`);
    console.log('');
  } catch (e) {
    console.error(`\n  Could not start the hub: ${e.message}\n`);
    process.exit(1);
  }
  const bye = async () => { await hub.stop(); process.exit(0); };
  process.on('SIGINT', bye);
  process.on('SIGTERM', bye);
}
