#!/usr/bin/env node
// Assemble a Tauri updater manifest (latest.json) from a directory of signed
// bundles. For every `*.sig` file it finds, it derives the platform key from
// the sibling artifact's filename and embeds the signature + a download URL.
//
// Usage:
//   node scripts/build-updater-manifest.mjs \
//     --dir <artifacts-dir> --version <x.y.z> --base-url <url-prefix> --out <path>
//
// `--base-url` is the public prefix the bundles will be served from, e.g.
//   https://updates.trymyelin.app/prerelease/0.2.0
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, arg, i, arr) => {
    if (arg.startsWith('--')) {
      pairs.push([arg.slice(2), arr[i + 1]]);
    }
    return pairs;
  }, []),
);

for (const required of ['dir', 'version', 'base-url', 'out']) {
  if (!args[required]) {
    console.error(`Missing --${required}`);
    process.exit(1);
  }
}

function platformKey(filename) {
  const name = filename.toLowerCase();
  let os;
  if (name.endsWith('.app.tar.gz')) {
    os = 'darwin';
  } else if (name.endsWith('.appimage')) {
    os = 'linux';
  } else if (
    name.endsWith('-setup.exe') ||
    name.endsWith('.nsis.zip') ||
    name.endsWith('.msi')
  ) {
    os = 'windows';
  } else {
    return null;
  }

  const arch = /aarch64|arm64/.test(name) ? 'aarch64' : 'x86_64';
  return `${os}-${arch}`;
}

const baseUrl = args['base-url'].replace(/\/$/, '');
const platforms = {};

for (const file of readdirSync(args.dir)) {
  if (!file.endsWith('.sig')) {
    continue;
  }
  const bundle = file.slice(0, -'.sig'.length);
  const key = platformKey(bundle);
  if (!key) {
    console.warn(`Skipping unrecognized artifact: ${bundle}`);
    continue;
  }
  platforms[key] = {
    signature: readFileSync(path.join(args.dir, file), 'utf8').trim(),
    url: `${baseUrl}/${bundle}`,
  };
}

if (Object.keys(platforms).length === 0) {
  console.error(`No updater artifacts (*.sig) found in ${args.dir}`);
  process.exit(1);
}

const manifest = {
  version: args.version,
  pub_date: new Date().toISOString(),
  platforms,
};

writeFileSync(args.out, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
  `Wrote ${args.out} with platforms: ${Object.keys(platforms).join(', ')}`,
);
