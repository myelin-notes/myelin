#!/usr/bin/env node
// Prune an updater channel (prerelease|stable) to the newest KEEP versions.
// Run BEFORE uploading a new version to make room under R2's 10GB cap: pruning
// first keeps the on-disk peak at KEEP sets instead of momentarily holding
// KEEP+1.
//
// Maintains <channel>/versions.json as the ordered index (oldest -> newest);
// VERSION is appended here so the upload that follows fills it in. Each pruned
// version's entire folder (<channel>/<version>/) is deleted by prefix, so every
// object under it goes -- bundles, .sig sidecars, the versioned latest.json, and
// any stragglers the manifest never referenced (e.g. the WiX .msi that
// build-updater-manifest.mjs drops in favour of the NSIS installer). Deleting by
// prefix needs S3's bulk delete; wrangler's r2 object command is single-key only.
//
// Usage: node scripts/prune-channel.mjs <prerelease|stable>
// Env: R2_BUCKET, VERSION, CLOUDFLARE_* for wrangler (versions.json get/put), and
//      AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY (an R2 token with Object Read &
//      Write) for the aws CLI that deletes the version prefixes.
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

// Delete every object under a prefix via R2's S3 API. The trailing slash on the
// prefix is load-bearing: it pins the delete to this exact version's folder so
// "0.1.3/" can't also sweep "0.1.30/" or "0.1.3-beta/". A non-existent prefix is
// a no-op (exit 0), keeping re-runs idempotent.
const deletePrefix = (prefix) =>
  execFileSync(
    'aws',
    [
      's3',
      'rm',
      `s3://${BUCKET}/${prefix}`,
      '--recursive',
      '--endpoint-url',
      'https://36d2d933c7d3e3155cf165b69f6c5df0.r2.cloudflarestorage.com',
    ],
    {
      stdio: ['ignore', 'inherit', 'inherit'],
      env: { ...process.env, AWS_DEFAULT_REGION: 'auto' },
    },
  );

function tryGetJson(key) {
  const dest = path.join(tmp, 'tmp.json');
  try {
    get(key, dest);
    return JSON.parse(readFileSync(dest, 'utf8'));
  } catch {
    return null;
  }
}

let versions = tryGetJson(`${CHANNEL}/versions.json`) ?? [];
versions = versions.filter((v) => v !== VERSION);
// Leave room for VERSION, which the subsequent upload step fills in.
while (versions.length > KEEP - 1) {
  const old = versions.shift();
  deletePrefix(`${CHANNEL}/${old}/`);
}
versions.push(VERSION);
const versionsPath = path.join(tmp, 'versions.json');
writeFileSync(versionsPath, `${JSON.stringify(versions, null, 2)}\n`);
put(`${CHANNEL}/versions.json`, versionsPath);

console.log(`Pruned ${CHANNEL}. Keeping: ${versions.join(', ')}`);
