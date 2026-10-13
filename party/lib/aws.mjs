// The only module (with outbox.mjs, which calls it via an injected push) that
// speaks to the network. CREDENTIAL RULE: the admin password goes into one
// request header and nowhere else - never an error message, a log line, a
// state file. Errors carry a route and a status code, never a response body
// (a gateway may echo the request headers into it) and never an underlying
// error object (which might carry request details).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export class AwsError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AwsError';
  }
}

export const API_URLS = {
  prod: 'https://qzq9gvuk9f.execute-api.us-east-1.amazonaws.com/prod',
  staging: 'https://9iz68mvngi.execute-api.us-east-1.amazonaws.com/prod',
};

const PASSWORD_FILE = { prod: 'prod-2026-08-20.txt', staging: 'staging-2026-08-20.txt' };
const REQUEST_TIMEOUT_MS = 15000;

export function loadPassword({ target = 'prod', env = process.env, home = homedir() } = {}) {
  if (env.ICUP_ADMIN_PASSWORD) return env.ICUP_ADMIN_PASSWORD;
  if (!Object.hasOwn(PASSWORD_FILE, target)) throw new AwsError(`unknown target "${target}" - use prod or staging`);
  const path = join(home, '.icup-admin-passwords', PASSWORD_FILE[target]);
  let text;
  try {
    text = readFileSync(path, 'utf8').trim();
  } catch {
    throw new AwsError(`cannot read ${path} - set ICUP_ADMIN_PASSWORD instead`);
  }
  if (!text) throw new AwsError(`${path} is empty - set ICUP_ADMIN_PASSWORD instead`);
  return text;
}

const signal = () => (typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(REQUEST_TIMEOUT_MS) : undefined);

async function request(route, verb, url, init, fetchImpl) {
  let res;
  try {
    res = await fetchImpl(url, { ...init, signal: signal() });
  } catch {
    // Deliberately drops the underlying error: only our own words escape.
    throw new AwsError(`${route} ${verb} failed (network error)`);
  }
  if (!res || !res.ok) throw new AwsError(`${route} ${verb} returned HTTP ${res ? res.status : 'none'}`);
  return res;
}

async function post(apiUrl, route, password, body, fetchImpl) {
  await request(route, 'POST', `${apiUrl}/${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-password': password },
    body: JSON.stringify(body),
  }, fetchImpl);
}

async function get(apiUrl, route, fetchImpl) {
  const res = await request(route, 'GET', `${apiUrl}/${route}`, {}, fetchImpl);
  try {
    return await res.json();
  } catch {
    throw new AwsError(`${route} GET returned a body that is not JSON`);
  }
}

export const putPairings = ({ apiUrl, password, items, fetchImpl = fetch }) =>
  post(apiUrl, 'pairings', password, { pairings: items }, fetchImpl);

export const getPairings = async ({ apiUrl, fetchImpl = fetch }) => {
  const body = await get(apiUrl, 'pairings', fetchImpl);
  return Array.isArray(body?.pairings) ? body.pairings : [];
};

export const putPlayers = ({ apiUrl, password, players, fetchImpl = fetch }) =>
  post(apiUrl, 'players', password, { players }, fetchImpl);

export const getPlayers = async ({ apiUrl, fetchImpl = fetch }) => {
  const body = await get(apiUrl, 'players', fetchImpl);
  return Array.isArray(body?.players) ? body.players : [];
};
