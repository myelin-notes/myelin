#!/usr/bin/env node
// Prune an updater channel (prerelease|stable) to the newest KEEP versions.
// Run BEFORE uploading a new version to make room under R2's 10GB cap: pruning
// first keeps the on-disk peak at KEEP sets instead of momentarily holding
// KEEP+1.
//
// Maintains <channel>/versions.json as the ordered index (oldest -> newest);
// VERSION is appended here so the upload that follows fills it in. For each
// pruned version it deletes the bundles, their .sig sidecars (best-effort -
// prerelease ships them, stable embeds the signature in latest.json), and the
// versioned latest.json.
//
// Usage: node scripts/prune-channel.mjs <prerelease|stable>
// Env: R2_BUCKET, VERSION, plus CLOUDFLARE_* for wrangler auth.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const { R2_BUCKET: BUCKET, VERSION } = process.env;
const CHANNEL = process.argv[2];
const KEEP = 2;

if (!BUCKET || !VERSION) {
  console.error('R2_BUCKET and VERSION are required');
  process.exit(1);
}
if (CHANNEL !== 'prerelease' && CHANNEL !== 'stable') {
  console.error('Usage: prune-channel.mjs <prerelease|stable>');
  process.exit(1);
}

const tmp = mkdtempSync(path.join(tmpdir(), 'prune-'));

function wrangler(args) {
  execFileSync('npx', ['--yes', 'wrangler@4', 'r2', 'object', ...args], {
    stdio: ['ignore', 'inherit', 'inherit'],
  });
}
const get = (key, dest) =>
  wrangler(['get', `${BUCKET}/${key}`, '--file', dest, '--remote']);
const put = (key, src) =>
  wrangler(['put', `${BUCKET}/${key}`, '--file', src, '--remote']);
const del = (key) => wrangler(['delete', `${BUCKET}/${key}`, '--remote']);

function tryGetJson(key) {
  const dest = path.join(tmp, 'tmp.json');
  try {
    get(key, dest);
    return JSON.parse(readFileSync(dest, 'utf8'));
  } catch {
    return null;
  }
}

const fileOf = (url) => url.split('/').pop();

let versions = tryGetJson(`${CHANNEL}/versions.json`) ?? [];
versions = versions.filter((v) => v !== VERSION);
// Leave room for VERSION, which the subsequent upload step fills in.
while (versions.length > KEEP - 1) {
  const old = versions.shift();
  const oldManifest = tryGetJson(`${CHANNEL}/${old}/latest.json`);
  if (oldManifest) {
    for (const p of Object.values(oldManifest.platforms)) {
      const file = fileOf(p.url);
      try {
        del(`${CHANNEL}/${old}/${file}`);
      } catch {}
      try {
        del(`${CHANNEL}/${old}/${file}.sig`);
      } catch {}
    }
    try {
      del(`${CHANNEL}/${old}/latest.json`);
    } catch {}
  }
}
versions.push(VERSION);
const versionsPath = path.join(tmp, 'versions.json');
writeFileSync(versionsPath, `${JSON.stringify(versions, null, 2)}\n`);
put(`${CHANNEL}/versions.json`, versionsPath);

console.log(`Pruned ${CHANNEL}. Keeping: ${versions.join(', ')}`);
