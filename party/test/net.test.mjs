import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickLanAddress, localHostName, operatorUrls, qrLines, qrSvg, pickTailnetAddress } from '../lib/net.mjs';

const REAL = {
  lo0: [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
  en0: [{ family: 'IPv4', address: '10.0.0.241', internal: false }],
  bridge100: [{ family: 'IPv4', address: '192.168.64.1', internal: false }],
  awdl0: [{ family: 'IPv6', address: 'fe80::1', internal: false }],
};

test('picks the wifi, not the VM bridge', () => {
  assert.deepEqual(pickLanAddress(REAL), { iface: 'en0', address: '10.0.0.241' });
});

test('picks the wifi even when the bridge is listed first', () => {
  const { bridge100, ...rest } = REAL;
  assert.equal(pickLanAddress({ bridge100, ...rest }).iface, 'en0');
});

test('prefers the lowest-numbered en interface', () => {
  assert.equal(pickLanAddress({
    en5: [{ family: 'IPv4', address: '10.0.0.9', internal: false }],
    en0: [{ family: 'IPv4', address: '10.0.0.1', internal: false }],
  }).address, '10.0.0.1');
});

test('en10 sorts after en2 (numeric, not alphabetical)', () => {
  assert.equal(pickLanAddress({
    en10: [{ family: 'IPv4', address: '10.0.0.10', internal: false }],
    en2: [{ family: 'IPv4', address: '10.0.0.2', internal: false }],
  }).address, '10.0.0.2');
});

test('falls back to any real IPv4 when there is no en', () => {
  assert.equal(pickLanAddress({ wlan0: [{ family: 'IPv4', address: '172.20.0.4', internal: false }] }).address, '172.20.0.4');
});

test('a virtual-only machine yields nothing rather than a bridge address', () => {
  assert.equal(pickLanAddress({ bridge100: REAL.bridge100, utun3: [{ family: 'IPv4', address: '100.1.1.1', internal: false }] }), null);
});

test('returns null when there is nothing routable', () => {
  assert.equal(pickLanAddress({ lo0: [{ family: 'IPv4', address: '127.0.0.1', internal: true }] }), null);
  assert.equal(pickLanAddress({}), null);
  assert.equal(pickLanAddress(null), null);
});

test('uses LocalHostName, not os.hostname', () => {
  const runner = () => ({ status: 0, stdout: 'Eriks-MacBook-Pro\n' });
  assert.equal(localHostName(runner), 'Eriks-MacBook-Pro.local');
});

test('asks scutil for LocalHostName specifically', () => {
  let seen;
  localHostName((cmd, args) => { seen = [cmd, ...args]; return { status: 0, stdout: 'x' }; });
  assert.deepEqual(seen, ['scutil', '--get', 'LocalHostName']);
});

test('no .local name when scutil is unavailable', () => {
  assert.equal(localHostName(() => ({ status: 1, stdout: '' })), null);
  assert.equal(localHostName(() => { throw new Error('ENOENT'); }), null);
  assert.equal(localHostName(() => ({ status: 0, stdout: '   \n' })), null);
});

test('a hostile LocalHostName cannot inject into the URL or page', () => {
  assert.equal(localHostName(() => ({ status: 0, stdout: '"><script>x</script>' })), null);
});

test('builds both URLs', () => {
  assert.deepEqual(operatorUrls({ address: '10.0.0.241', hostName: 'Eriks-MacBook-Pro.local', port: 8722 }), {
    ip: 'http://10.0.0.241:8722/operator',
    mdns: 'http://Eriks-MacBook-Pro.local:8722/operator',
  });
  assert.equal(operatorUrls({ address: '10.0.0.241', hostName: null, port: 8722 }).mdns, null);
  assert.equal(operatorUrls({ address: null, hostName: null, port: 8722 }).ip, null);
});

test('renders a scannable terminal QR with a quiet zone', () => {
  const lines = qrLines('http://10.0.0.241:8722/operator');
  // 29 modules for this payload at error level M, plus 2 modules of quiet zone each side.
  assert.equal(lines.length, 33);
  assert.ok(lines.every((l) => l.includes('\u001b[')), 'rows should be ANSI coloured');
});

test('renders an SVG for the landing page', () => {
  const svg = qrSvg('http://10.0.0.241:8722/operator', 6);
  assert.match(svg, /^<svg /);
  assert.match(svg, /<\/svg>/);
});

// --- the Tailscale fallback ------------------------------------------------
// The spare key for a venue whose wifi isolates its clients. It must be found
// when it is there, and must never be confused with the LAN address.

test('finds the tailnet address on a utun interface', () => {
  assert.deepEqual(pickTailnetAddress({
    ...REAL,
    utun8: [{ family: 'IPv4', address: '100.123.144.36', internal: false }],
  }), { iface: 'utun8', address: '100.123.144.36' });
});

test('no Tailscale means no tailnet address, not a guess', () => {
  assert.equal(pickTailnetAddress(REAL), null);
});

test('the LAN address is never reported as the tailnet one, or the reverse', () => {
  const both = { ...REAL, utun8: [{ family: 'IPv4', address: '100.123.144.36', internal: false }] };
  assert.equal(pickLanAddress(both).address, '10.0.0.241');
  assert.equal(pickTailnetAddress(both).address, '100.123.144.36');
});

// 100.0.0.0/8 is ordinary public space; only 100.64.0.0/10 is the carrier-grade
// NAT range Tailscale allocates from. A VPN on utun handing out 100.5.x would
// otherwise be printed on the card as the fallback and fail in the room.
test('only 100.64.0.0/10 counts, not the whole of 100/8', () => {
  const at = (addr) => pickTailnetAddress({ utun4: [{ family: 'IPv4', address: addr, internal: false }] });
  assert.equal(at('100.5.1.1'), null);
  assert.equal(at('100.63.255.255'), null);
  assert.equal(at('100.128.0.1'), null);
  assert.equal(at('100.64.0.1').address, '100.64.0.1');
  assert.equal(at('100.127.255.254').address, '100.127.255.254');
});

test('a tunnel that is not utun is not mistaken for Tailscale', () => {
  assert.equal(pickTailnetAddress({ ppp0: [{ family: 'IPv4', address: '100.100.1.1', internal: false }] }), null);
});
