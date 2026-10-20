import { networkInterfaces } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const qrcode = require('../vendor/qrcode.js');

const VIRTUAL = /^(bridge|utun|awdl|llw|tun|tap|vmnet|vnic|anpi|ap\d)/;

export function pickLanAddress(interfaces = networkInterfaces()) {
  const candidates = [];
  for (const [iface, addrs] of Object.entries(interfaces || {})) {
    if (VIRTUAL.test(iface)) continue;
    for (const a of addrs || []) {
      // Node 18.0-18.3 reported family as a number; accept both spellings.
      if ((a.family !== 'IPv4' && a.family !== 4) || a.internal) continue;
      const m = /^en(\d+)$/.exec(iface);
      candidates.push({ iface, address: a.address, rank: m ? Number(m[1]) : 1000 });
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.rank - b.rank || a.iface.localeCompare(b.iface));
  return { iface: candidates[0].iface, address: candidates[0].address };
}

// The Tailscale fallback, for a venue whose wifi isolates its clients so the
// iPad cannot see the laptop at all. Tailscale hands every device an address in
// 100.64.0.0/10 on a utun interface, and that address is stable across networks
// and reboots - which is the whole point, since the LAN address is not.
//
// Deliberately NOT part of pickLanAddress: utun is in VIRTUAL and stays there.
// The QR code and the banner must keep pointing at the LAN address, because
// that is the path the night is meant to run on. This is the spare key, and it
// is reported separately so it reads as one.
export function pickTailnetAddress(interfaces = networkInterfaces()) {
  for (const [iface, addrs] of Object.entries(interfaces || {})) {
    if (!/^utun/.test(iface)) continue;
    for (const a of addrs || []) {
      if ((a.family !== 'IPv4' && a.family !== 4) || a.internal) continue;
      // 100.64.0.0/10 is the carrier-grade NAT range Tailscale allocates from:
      // second octet 64..127, and nothing else on the machine uses it.
      const m = /^100\.(\d+)\./.exec(a.address);
      if (m && Number(m[1]) >= 64 && Number(m[1]) <= 127) return { iface, address: a.address };
    }
  }
  return null;
}

// os.hostname() is "MacBookPro" here and does not resolve over mDNS.
// The Bonjour name macOS actually advertises is scutil's LocalHostName.
export function localHostName(runner = spawnSync) {
  if (process.platform !== 'darwin' && runner === spawnSync) return null;
  let r;
  try {
    r = runner('scutil', ['--get', 'LocalHostName'], { encoding: 'utf8' });
  } catch {
    return null;
  }
  if (!r || r.status !== 0) return null;
  const name = String(r.stdout || '').trim();
  // The name ends up in a URL and in HTML: only hostname characters are allowed.
  return /^[A-Za-z0-9-]+$/.test(name) ? `${name}.local` : null;
}

export function operatorUrls({ address, hostName, port }) {
  return {
    ip: address ? `http://${address}:${port}/operator` : null,
    mdns: hostName ? `http://${hostName}:${port}/operator` : null,
  };
}

function makeCode(text) {
  const code = qrcode(0, 'M');
  code.addData(text);
  code.make();
  return code;
}

const WHITE = '\u001b[47m  \u001b[0m';
const BLACK = '\u001b[40m  \u001b[0m';
const QUIET = 2;

// Dark modules must read dark to a camera, so paint explicit backgrounds
// rather than trusting whatever colour the terminal happens to be.
export function qrLines(text) {
  const code = makeCode(text);
  const n = code.getModuleCount();
  const lines = [];
  for (let r = -QUIET; r < n + QUIET; r++) {
    let line = '';
    for (let c = -QUIET; c < n + QUIET; c++) {
      const dark = r >= 0 && r < n && c >= 0 && c < n && code.isDark(r, c);
      line += dark ? BLACK : WHITE;
    }
    lines.push(line);
  }
  return lines;
}

export function qrSvg(text, cellSize = 6) {
  return makeCode(text).createSvgTag(cellSize, QUIET * cellSize);
}
