#!/usr/bin/env node
// Promote an already-published prerelease to the stable channel by copying its
// bundles from prerelease/<version>/ to stable/<version>/ in R2, rewriting the
// manifest URLs, and pruning stable to the newest 2 versions.
//
// No rebuild: the bytes (and their embedded signatures) are reused verbatim.
//
// Env: R2_BUCKET, UPDATER_DOMAIN, VERSION, plus CLOUDFLARE_* for wrangler auth.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const { R2_BUCKET: BUCKET, VERSION } = process.env;
const KEEP = 2;

if (!BUCKET || !VERSION) {
  console.error('R2_BUCKET and VERSION are required');
  process.exit(1);
}

const tmp = mkdtempSync(path.join(tmpdir(), 'promote-'));

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

// 1. Source manifest — the exact signatures for this version.
const srcPath = path.join(tmp, 'src.json');
get(`prerelease/${VERSION}/latest.json`, srcPath);
const manifest = JSON.parse(readFileSync(srcPath, 'utf8'));
if (manifest.version !== VERSION) {
  console.error(
    `prerelease manifest is ${manifest.version}, expected ${VERSION}`,
  );
  process.exit(1);
}

// 2. Copy each platform bundle prerelease/<v>/ -> stable/<v>/.
for (const { url } of Object.values(manifest.platforms)) {
  const file = fileOf(url);
  const local = path.join(tmp, file);
  get(`prerelease/${VERSION}/${file}`, local);
  put(`stable/${VERSION}/${file}`, local);
}

// 3. Rewrite URLs to the stable channel and publish the manifest.
const stable = JSON.parse(JSON.stringify(manifest));
for (const p of Object.values(stable.platforms)) {
  p.url = p.url.replace('/prerelease/', '/stable/');
}
const stablePath = path.join(tmp, 'stable.json');
writeFileSync(stablePath, `${JSON.stringify(stable, null, 2)}\n`);
put(`stable/${VERSION}/latest.json`, stablePath);
put('stable/latest.json', stablePath); // live switch the app polls

// 4. Update the version index and prune to the newest KEEP versions.
let versions = tryGetJson('stable/versions.json') ?? [];
versions = versions.filter((v) => v !== VERSION);
versions.push(VERSION);
while (versions.length > KEEP) {
  const old = versions.shift();
  const oldManifest = tryGetJson(`stable/${old}/latest.json`);
  if (oldManifest) {
    for (const p of Object.values(oldManifest.platforms)) {
      try {
        del(`stable/${old}/${fileOf(p.url)}`);
      } catch {}
    }
    try {
      del(`stable/${old}/latest.json`);
    } catch {}
  }
}
const versionsPath = path.join(tmp, 'versions.json');
writeFileSync(versionsPath, `${JSON.stringify(versions, null, 2)}\n`);
put('stable/versions.json', versionsPath);

console.log(`Promoted ${VERSION} to stable. Kept: ${versions.join(', ')}`);
