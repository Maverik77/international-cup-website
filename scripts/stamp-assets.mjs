#!/usr/bin/env node
/**
 * Stamp local CSS/JS references in HTML with a content hash.
 *
 * S3 serves these assets with max-age=31536000, so a returning visitor keeps
 * whatever they cached until the URL changes. Hand-written ?v= strings drift
 * and get forgotten; a hash of the file itself cannot. Re-run after changing
 * any asset, and only the files that actually changed get a new URL.
 *
 *   node scripts/stamp-assets.mjs [--check]
 *
 * --check exits non-zero if anything is out of date, for CI.
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, resolve, relative } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const checkOnly = process.argv.includes('--check');
const SKIP = new Set(['node_modules', '.git', '.aws-sam', 'lambda', 'results', 'pics', 'data']);

function htmlFiles(dir, out = []) {
    for (const name of readdirSync(dir)) {
        if (SKIP.has(name)) continue;
        const full = join(dir, name);
        if (statSync(full).isDirectory()) htmlFiles(full, out);
        else if (name.endsWith('.html')) out.push(full);
    }
    return out;
}

const hashes = new Map();
function hashOf(file) {
    if (!hashes.has(file)) {
        hashes.set(file, createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 8));
    }
    return hashes.get(file);
}

// Local .css/.js only: skip absolute URLs and protocol-relative CDN links.
const REF = /(href|src)="((?!https?:|\/\/)[^"]+?\.(?:css|js))(\?[^"]*)?"/g;

let changed = 0, stale = [];
for (const html of htmlFiles(root)) {
    const before = readFileSync(html, 'utf8');
    const after = before.replace(REF, (match, attr, path, query) => {
        const asset = resolve(dirname(html), path);
        if (!existsSync(asset)) {
            console.warn(`  missing: ${relative(root, html)} -> ${path}`);
            return match;
        }
        const want = `?v=${hashOf(asset)}`;
        if (query === want) return match;
        stale.push(`${relative(root, html)}: ${path}`);
        return `${attr}="${path}${want}"`;
    });
    if (after !== before) {
        changed++;
        if (!checkOnly) writeFileSync(html, after);
    }
}

if (checkOnly) {
    if (stale.length) {
        console.error(`${stale.length} reference(s) out of date:\n  ` + stale.join('\n  '));
        process.exit(1);
    }
    console.log('All asset references are current.');
} else {
    console.log(`${stale.length} reference(s) stamped across ${changed} file(s).`);
}
