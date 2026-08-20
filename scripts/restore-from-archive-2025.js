#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ScanCommand, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { getClients, assertAccount, confirm, sleep } from './lib/aws.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ARCHIVE_DIR = resolve(REPO_ROOT, 'data/archive/2025');

// Source archive file -> destination live table.
const FILE_TO_TABLE = {
  'players.json':       'icup-players-prod',
  'pairings.json':      'icup-pairings-prod',
  'match-results.json': 'icup-match-results-prod',
};

// Betslips are restored from the private archive DDB table (they may hold binary/complex types
// that don't round-trip as cleanly through JSON as the other tables). Betting-config is a single
// row and typically hand-repopulated; not restored automatically here.

async function main() {
  await assertAccount();
  console.log('\n!! You are about to RESTORE data into live prod tables. !!');
  console.log('This overwrites current live data with archived 2025 data.\n');
  await confirm('confirm: ', 'RESTORE-2025');
  await restoreFromJson();
  await restoreBetslipsFromArchiveTable();
  console.log('\n[ok] restore complete. betting-config-prod is NOT restored — repopulate manually if needed.');
}

async function restoreFromJson() {
  const { doc } = getClients();
  for (const [file, table] of Object.entries(FILE_TO_TABLE)) {
    const path = resolve(ARCHIVE_DIR, file);
    const items = JSON.parse(await readFile(path, 'utf8'));
    console.log(`\n=== restore ${table} from ${file} (${items.length} items) ===`);
    await batchWriteAll(doc, table, items);
    console.log(`  [OK] wrote ${items.length}`);
  }
}

async function restoreBetslipsFromArchiveTable() {
  const { doc } = getClients();
  console.log('\n=== restore icup-betslips-prod from icup-betslips-archive ===');
  const items = [];
  let ExclusiveStartKey;
  do {
    const res = await doc.send(new ScanCommand({ TableName: 'icup-betslips-archive', ExclusiveStartKey }));
    for (const it of res.Items ?? []) {
      const { year, ...rest } = it;
      if (year === 2025) items.push(rest);
    }
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  await batchWriteAll(doc, 'icup-betslips-prod', items);
  console.log(`  [OK] restored ${items.length} betslips (year=2025 items only, year attribute stripped)`);
}

async function batchWriteAll(doc, table, items) {
  const CHUNK = 25;
  for (let i = 0; i < items.length; i += CHUNK) {
    let requests = items.slice(i, i + CHUNK).map((Item) => ({ PutRequest: { Item } }));
    let attempts = 0;
    while (requests.length > 0) {
      const res = await doc.send(new BatchWriteCommand({ RequestItems: { [table]: requests } }));
      const unproc = res.UnprocessedItems?.[table] ?? [];
      if (unproc.length === 0) break;
      attempts += 1;
      if (attempts > 5) throw new Error(`batch write on ${table} keeps failing`);
      await sleep(200 * Math.pow(2, attempts));
      requests = unproc;
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('[fatal]', err);
    process.exit(1);
  });
}
