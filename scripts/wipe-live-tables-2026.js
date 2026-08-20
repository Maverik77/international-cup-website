#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ScanCommand, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import { getClients, assertAccount, confirm, sleep } from './lib/aws.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ARCHIVE_DIR = resolve(REPO_ROOT, 'data/archive/2025');

// Table -> array of key attribute names (in KeySchema order).
const TABLES = {
  'icup-players-prod':         ['id'],
  'icup-pairings-prod':        ['id'],
  'icup-match-results-prod':   ['matchId'],
  'icup-betslips-prod':        ['betslipId'],
  'icup-betting-config-prod':  ['configId'],
};

async function main() {
  await assertAccount();
  await sanityCheck();
  console.log('\n!! You are about to WIPE 5 live prod DynamoDB tables. !!');
  console.log('Archive verified above. Type WIPE-2026 (case-sensitive) to proceed.\n');
  await confirm('confirm: ', 'WIPE-2026');
  await wipeAll();
  console.log('\n[ok] wipe complete');
}

async function sanityCheck() {
  console.log('\n=== sanity check: archive must exist before wipe ===');
  const requiredFiles = ['players.json', 'pairings.json', 'match-results.json', 'news.json', 'schedule.json'];
  for (const f of requiredFiles) {
    const path = resolve(ARCHIVE_DIR, f);
    if (!existsSync(path)) throw new Error(`archive missing: ${path}`);
    const content = readFileSync(path, 'utf8');
    if (content.trim().length === 0) throw new Error(`archive empty: ${path}`);
    console.log(`  [OK] ${path}`);
  }

  const { doc } = getClients();
  const trCount = await scanCount(doc, 'icup-tournament-results-prod');
  console.log(`  icup-tournament-results-prod count: ${trCount}`);
  if (trCount < 96) throw new Error(`tournament-results-prod has ${trCount}, expected ≥ 96`);
  const bsCount = await scanCount(doc, 'icup-betslips-archive');
  console.log(`  icup-betslips-archive count: ${bsCount}`);
  if (bsCount < 12) throw new Error(`betslips-archive has ${bsCount}, expected ≥ 12`);
  console.log('  [OK] destination tables have expected rows');
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

async function wipeAll() {
  const { doc } = getClients();
  for (const [table, keyAttrs] of Object.entries(TABLES)) {
    const before = await scanCount(doc, table);
    console.log(`\n=== wipe ${table} (before=${before}) ===`);
    if (before === 0) { console.log('  [skip] already empty'); continue; }
    await scanAndDelete(doc, table, keyAttrs);
    const after = await scanCount(doc, table);
    console.log(`  [${after === 0 ? 'OK' : 'FAIL'}] ${table} after=${after}`);
    if (after !== 0) throw new Error(`wipe incomplete on ${table}: ${after} rows remain`);
  }
}

async function scanAndDelete(doc, table, keyAttrs) {
  let ExclusiveStartKey;
  do {
    const scan = await doc.send(new ScanCommand({
      TableName: table,
      ProjectionExpression: keyAttrs.map((_, i) => `#k${i}`).join(','),
      ExpressionAttributeNames: Object.fromEntries(keyAttrs.map((k, i) => [`#k${i}`, k])),
      ExclusiveStartKey,
    }));
    const items = scan.Items ?? [];
    for (let i = 0; i < items.length; i += 25) {
      let requests = items.slice(i, i + 25).map((it) => {
        const Key = Object.fromEntries(keyAttrs.map((k) => [k, it[k]]));
        return { DeleteRequest: { Key } };
      });
      let attempts = 0;
      while (requests.length > 0) {
        const res = await doc.send(new BatchWriteCommand({ RequestItems: { [table]: requests } }));
        const unproc = res.UnprocessedItems?.[table] ?? [];
        if (unproc.length === 0) break;
        attempts += 1;
        if (attempts > 5) throw new Error(`batch delete on ${table} keeps failing`);
        await sleep(200 * Math.pow(2, attempts));
        requests = unproc;
      }
    }
    ExclusiveStartKey = scan.LastEvaluatedKey;
  } while (ExclusiveStartKey);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('[fatal]', err);
    process.exit(1);
  });
}
