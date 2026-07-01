#!/usr/bin/env node
// Promote an already-published prerelease to the stable channel by copying its
// bundles from prerelease/<version>/ to stable/<version>/ in R2, rewriting the
// manifest URLs, and publishing the stable manifest.
//
// No rebuild: the bytes (and their embedded signatures) are reused verbatim.
// Stable is pruned separately by scripts/prune-channel.mjs (run before this).
//
// Env: R2_BUCKET, UPDATER_DOMAIN, VERSION, plus CLOUDFLARE_* for wrangler auth.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const { R2_BUCKET: BUCKET, VERSION } = process.env;

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

// 2. Copy each platform bundle prerelease/<v>/ -> stable/<v>/. Dedupe by
// filename: the universal macOS bundle is shared by both darwin keys, so it
// would otherwise be copied twice.
const bundles = new Set(
  Object.values(manifest.platforms).map(({ url }) => fileOf(url)),
);
for (const file of bundles) {
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

// 4. The macOS .dmg is the human-facing installer the website links to. It's
// not an updater artifact (absent from latest.json), so it isn't copied by the
// loop above; move it into this version's stable folder under the fixed name the
// release workflow uploaded. Windows (-setup.exe) and Linux (.AppImage)
// installers double as updater artifacts, so they're already in stable/<v>/ and
// are discoverable straight from latest.json.
const dmgLocal = path.join(tmp, 'Myelin-macOS.dmg');
get(`prerelease/${VERSION}/Myelin-macOS.dmg`, dmgLocal);
put(`stable/${VERSION}/Myelin-macOS.dmg`, dmgLocal);

console.log(`Promoted ${VERSION} to stable.`);
