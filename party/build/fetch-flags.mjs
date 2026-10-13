import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
export const FLAG_CODES = JSON.parse(readFileSync(join(HERE, 'flags.json'), 'utf8'));
export const DEFAULT_FLAGS_DIR = resolve(HERE, '..', 'assets', 'flags');
export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
export const MIN_PNG_BYTES = 1024;

export class FlagError extends Error {}

export function flagPathFor(country, flagsDir = DEFAULT_FLAGS_DIR) {
  if (typeof country !== 'string' || country.trim() === '') {
    throw new FlagError(
      `Player has no country (got ${country === '' ? 'an empty string' : String(country)}), so there is no flag to draw. ` +
      `Set "country" for that player in contacts/player-details.json; any new country also needs an entry in ` +
      `party/build/flags.json, then run: npm run party:flags`,
    );
  }
  const code = Object.hasOwn(FLAG_CODES, country) ? FLAG_CODES[country] : undefined;
  if (!code) {
    throw new FlagError(
      `No flag for "${country}". Add it to party/build/flags.json with its flagcdn ` +
      `code (see https://flagcdn.com), then run: npm run party:flags`,
    );
  }
  return join(flagsDir, `${code}.png`);
}

// Throws unless buf is plausibly a real PNG: right signature and bigger than 1KB.
export function validatePng(buf, label) {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new FlagError(`${label} is not a PNG (bad signature) - the CDN may have sent an error page`);
  }
  if (buf.length <= MIN_PNG_BYTES) {
    throw new FlagError(`${label} is only ${buf.length} bytes - too small to be a real flag`);
  }
}

function dimensions(path) {
  const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height', '-of', 'csv=p=0', path]);
  if (probe.status !== 0) throw new FlagError(`${path} downloaded but ffprobe cannot read it`);
  return probe.stdout.toString().trim().replace(',', 'x');
}

export async function fetchFlags(flagsDir = DEFAULT_FLAGS_DIR, fetchImpl = fetch) {
  mkdirSync(flagsDir, { recursive: true });
  const results = [];
  for (const [country, code] of Object.entries(FLAG_CODES)) {
    const path = join(flagsDir, `${code}.png`);
    let status = 'already there';
    let buf = existsSync(path) ? readFileSync(path) : null;
    try {
      if (buf) validatePng(buf, path);
    } catch {
      buf = null; // an existing file that fails validation is re-fetched
    }
    if (!buf) {
      const url = `https://flagcdn.com/w2560/${code}.png`;
      const res = await fetchImpl(url);
      if (!res.ok) throw new FlagError(`${url} returned HTTP ${res.status}`);
      buf = Buffer.from(await res.arrayBuffer());
      validatePng(buf, url); // validate before anything touches disk
      writeFileSync(path, buf);
      status = 'downloaded';
    }
    let size;
    try {
      size = dimensions(path);
    } catch (e) {
      rmSync(path, { force: true });
      throw e;
    }
    results.push({ country, code, file: `${code}.png`, bytes: buf.length, size, status });
  }
  return results;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const results = await fetchFlags();
  console.log('country    file          bytes     dimensions  status');
  for (const r of results) {
    console.log(`${r.country.padEnd(10)} ${r.file.padEnd(13)} ${String(r.bytes).padStart(8)}  ${r.size.padEnd(11)} ${r.status}`);
  }
  console.log(`\n${results.length} flags in ${DEFAULT_FLAGS_DIR}`);
}
