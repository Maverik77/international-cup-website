#!/usr/bin/env node
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  CreateTableCommand,
  DescribeTableCommand,
  ResourceNotFoundException,
  waitUntilTableExists,
} from '@aws-sdk/client-dynamodb';
import { ScanCommand, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { getClients, assertAccount, sleep } from './lib/aws.js';

const ARCHIVE_YEAR = 2025;
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ARCHIVE_DIR = resolve(REPO_ROOT, `data/archive/${ARCHIVE_YEAR}`);
const MANIFEST_PATH = resolve(REPO_ROOT, 'data/archive/index.json');
const NEWS_SRC = resolve(REPO_ROOT, 'data/news.json');
const SCHEDULE_PATH = resolve(ARCHIVE_DIR, 'schedule.json');

const EXPECTED_COUNTS = {
  'icup-players-prod': 48,
  'icup-pairings-prod': 36,
  'icup-match-results-prod': 36,
  'icup-betslips-prod': 12,
  'icup-betting-config-prod': 1,
  'icup-tournament-results-staging': 96,
};

async function main() {
  await assertAccount();
  await precheck();
  await createTournamentResultsProdTable();
  await createBetslipsArchiveTable();
  await exportStaticSnapshots();
  await promoteTournamentResults();
  await copyBetslipsToArchive();
  await verify();
  console.log('\n[ok] archive complete');
}

async function precheck() {
  console.log('\n=== precheck ===');
  const { doc } = getClients();
  for (const [table, expected] of Object.entries(EXPECTED_COUNTS)) {
    const count = await scanCount(doc, table);
    const marker = count === expected ? 'OK' : 'MISMATCH';
    console.log(`  [${marker}] ${table}: got ${count}, expected ${expected}`);
    if (count !== expected) {
      throw new Error(`precheck failed on ${table}: got ${count}, expected ${expected}`);
    }
  }
  if (!existsSync(SCHEDULE_PATH)) {
    throw new Error(`missing hand-authored ${SCHEDULE_PATH} — create it before running (see Task 5)`);
  }
  if (!existsSync(NEWS_SRC)) {
    throw new Error(`missing ${NEWS_SRC}`);
  }
  console.log('  [OK] schedule.json + news.json present');
}

async function scanCount(doc, table) {
  let count = 0;
  let ExclusiveStartKey;
  do {
    const res = await doc.send(new ScanCommand({ TableName: table, Select: 'COUNT', ExclusiveStartKey }));
    count += res.Count ?? 0;
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return count;
}

async function createTournamentResultsProdTable() {
  const name = 'icup-tournament-results-prod';
  if (await tableExists(name)) {
    console.log(`\n=== ${name} already exists — skip create ===`);
    return;
  }
  console.log(`\n=== create ${name} ===`);
  const { ddb } = getClients();
  await ddb.send(new CreateTableCommand({
    TableName: name,
    AttributeDefinitions: [
      { AttributeName: 'yearMatchId', AttributeType: 'S' },
      { AttributeName: 'dataType',    AttributeType: 'S' },
      { AttributeName: 'year',        AttributeType: 'N' },
      { AttributeName: 'dayMatchNumber', AttributeType: 'S' },
      { AttributeName: 'playerName',  AttributeType: 'S' },
    ],
    KeySchema: [
      { AttributeName: 'yearMatchId', KeyType: 'HASH' },
      { AttributeName: 'dataType',    KeyType: 'RANGE' },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'year-day-index',
        KeySchema: [
          { AttributeName: 'year', KeyType: 'HASH' },
          { AttributeName: 'dayMatchNumber', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
      },
      {
        IndexName: 'player-index',
        KeySchema: [
          { AttributeName: 'playerName', KeyType: 'HASH' },
          { AttributeName: 'yearMatchId', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
      },
    ],
    BillingMode: 'PAY_PER_REQUEST',
  }));
  await waitUntilTableExists({ client: ddb, maxWaitTime: 120 }, { TableName: name });
  console.log(`  [OK] created ${name}`);
}

async function createBetslipsArchiveTable() {
  const name = 'icup-betslips-archive';
  if (await tableExists(name)) {
    console.log(`\n=== ${name} already exists — skip create ===`);
    return;
  }
  console.log(`\n=== create ${name} ===`);
  const { ddb } = getClients();
  await ddb.send(new CreateTableCommand({
    TableName: name,
    AttributeDefinitions: [{ AttributeName: 'betslipId', AttributeType: 'S' }],
    KeySchema: [{ AttributeName: 'betslipId', KeyType: 'HASH' }],
    BillingMode: 'PAY_PER_REQUEST',
  }));
  await waitUntilTableExists({ client: ddb, maxWaitTime: 120 }, { TableName: name });
  console.log(`  [OK] created ${name}`);
}

async function tableExists(name) {
  const { ddb } = getClients();
  try {
    await ddb.send(new DescribeTableCommand({ TableName: name }));
    return true;
  } catch (err) {
    if (err instanceof ResourceNotFoundException) return false;
    throw err;
  }
}

async function exportStaticSnapshots() {
  console.log(`\n=== export static snapshots to ${ARCHIVE_DIR} ===`);
  await mkdir(ARCHIVE_DIR, { recursive: true });
  const { doc } = getClients();

  const players = await scanAll(doc, 'icup-players-prod');
  const pairings = await scanAll(doc, 'icup-pairings-prod');
  const matchResults = await scanAll(doc, 'icup-match-results-prod');

  await writeJson(resolve(ARCHIVE_DIR, 'players.json'), players);
  await writeJson(resolve(ARCHIVE_DIR, 'pairings.json'), pairings);
  await writeJson(resolve(ARCHIVE_DIR, 'match-results.json'), matchResults);

  // Copy news verbatim.
  const news = JSON.parse(await readFile(NEWS_SRC, 'utf8'));
  await writeJson(resolve(ARCHIVE_DIR, 'news.json'), news);

  console.log(`  [OK] wrote players(${players.length}), pairings(${pairings.length}), match-results(${matchResults.length}), news(${news.length})`);

  await updateManifest(matchResults, pairings);
}

async function scanAll(doc, table) {
  const items = [];
  let ExclusiveStartKey;
  do {
    const res = await doc.send(new ScanCommand({ TableName: table, ExclusiveStartKey }));
    items.push(...(res.Items ?? []));
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

async function writeJson(path, obj) {
  await writeFile(path, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

async function updateManifest(matchResults, pairings) {
  const schedule = JSON.parse(await readFile(SCHEDULE_PATH, 'utf8'));
  const { winner, finalScore } = summarizeResults(matchResults, pairings);

  let manifest = { years: [] };
  if (existsSync(MANIFEST_PATH)) {
    manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
  }
  manifest.years = manifest.years.filter((y) => y.year !== ARCHIVE_YEAR);
  manifest.years.push({
    year: ARCHIVE_YEAR,
    dates: schedule.dates,
    venue: schedule.venue?.name ?? null,
    winner,
    finalScore,
  });
  manifest.years.sort((a, b) => b.year - a.year);

  await writeJson(MANIFEST_PATH, manifest);
  console.log(`  [OK] manifest entry: year=${ARCHIVE_YEAR} winner=${winner} score="${finalScore}"`);
}

function summarizeResults(matchResults, pairings) {
  // 2025 scoring:
  //   - Day 1 team matches (type: 'team'): 6 pts per match. Win = 4.5–1.5 (assumed pending exact breakdown). Tie = 3–3.
  //   - Day 2 singles (type: 'singles'): 3 pts per match. Win = 3–0. Tie = 1.5–1.5.
  // Total pool = 12*6 + 24*3 = 144 pts.
  const pairById = new Map(pairings.map((p) => [p.id, p]));
  let usa = 0;
  let intl = 0;
  for (const r of matchResults) {
    const p = pairById.get(r.matchId);
    if (!p) continue;
    const isTeam = p.type === 'team';
    if (r.winner === 'USA') {
      usa += isTeam ? 4.5 : 3;
      intl += isTeam ? 1.5 : 0;
    } else if (r.winner === 'International') {
      intl += isTeam ? 4.5 : 3;
      usa += isTeam ? 1.5 : 0;
    } else if (r.winner === 'Tie') {
      usa += isTeam ? 3 : 1.5;
      intl += isTeam ? 3 : 1.5;
    }
  }
  const winner = usa > intl ? 'USA' : intl > usa ? 'International' : 'Tie';
  const finalScore = `USA ${fmtHalf(usa)} – International ${fmtHalf(intl)}`;
  return { winner, finalScore };
}

function fmtHalf(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

async function promoteTournamentResults() {
  console.log('\n=== promote hole-by-hole: staging -> prod ===');
  const { doc } = getClients();
  const items = await scanAll(doc, 'icup-tournament-results-staging');
  console.log(`  scanned ${items.length} items from staging`);
  await batchWriteAll(doc, 'icup-tournament-results-prod', items);
  console.log(`  [OK] wrote ${items.length} to icup-tournament-results-prod`);
}

async function copyBetslipsToArchive() {
  console.log('\n=== copy betslips to private archive ===');
  const { doc } = getClients();
  const items = await scanAll(doc, 'icup-betslips-prod');
  const stamped = items.map((it) => ({ ...it, year: ARCHIVE_YEAR }));
  await batchWriteAll(doc, 'icup-betslips-archive', stamped);
  console.log(`  [OK] wrote ${stamped.length} to icup-betslips-archive (year=${ARCHIVE_YEAR})`);
}

async function batchWriteAll(doc, table, items) {
  const CHUNK = 25;
  for (let i = 0; i < items.length; i += CHUNK) {
    let requests = items.slice(i, i + CHUNK).map((Item) => ({ PutRequest: { Item } }));
    let attempts = 0;
    while (requests.length > 0) {
      const res = await doc.send(new BatchWriteCommand({ RequestItems: { [table]: requests } }));
      const unprocessed = res.UnprocessedItems?.[table] ?? [];
      if (unprocessed.length === 0) break;
      attempts += 1;
      if (attempts > 5) throw new Error(`batch write to ${table} keeps failing (${unprocessed.length} unprocessed)`);
      await sleep(200 * Math.pow(2, attempts));
      requests = unprocessed;
    }
  }
}

async function verify() {
  console.log('\n=== verify ===');
  const { doc } = getClients();
  const checks = [
    ['icup-tournament-results-prod', 96],
    ['icup-betslips-archive', 12],
  ];
  for (const [table, expected] of checks) {
    const count = await scanCount(doc, table);
    const marker = count === expected ? 'OK' : 'FAIL';
    console.log(`  [${marker}] ${table}: got ${count}, expected ≥ ${expected}`);
    if (count < expected) throw new Error(`verify failed on ${table}`);
  }

  const files = ['players.json', 'pairings.json', 'match-results.json', 'news.json'];
  for (const f of files) {
    const path = resolve(ARCHIVE_DIR, f);
    const contents = JSON.parse(await readFile(path, 'utf8'));
    console.log(`  [OK] ${path} exists (${contents.length} items)`);
  }

  // Sample 1 row per snapshot to eyeball shape.
  for (const f of files) {
    const path = resolve(ARCHIVE_DIR, f);
    const contents = JSON.parse(await readFile(path, 'utf8'));
    if (contents.length > 0) {
      console.log(`  sample ${f}:`, JSON.stringify(contents[0]).slice(0, 200));
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('[fatal]', err);
    process.exit(1);
  });
}
