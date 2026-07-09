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
//   https://updates.trymyelin.app/stable/0.2.0
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

// Maps a bundle filename to the updater platform keys it serves. We build
// exactly three targets: Windows x86_64 (-setup.exe), Linux x86_64 (.AppImage),
// and a universal macOS bundle (.app.tar.gz) that runs on both arches, so it
// serves both darwin keys the updater client may ask for.
function platformKeys(filename) {
  const name = filename.toLowerCase();
  if (name.endsWith('.app.tar.gz')) {
    return ['darwin-aarch64', 'darwin-x86_64'];
  }
  if (name.endsWith('.appimage')) {
    return ['linux-x86_64'];
  }
  if (name.endsWith('-setup.exe')) {
    return ['windows-x86_64'];
  }
  return null;
}

const baseUrl = args['base-url'].replace(/\/$/, '');
const platforms = {};

for (const file of readdirSync(args.dir)) {
  if (!file.endsWith('.sig')) {
    continue;
  }
  const bundle = file.slice(0, -'.sig'.length);
  const keys = platformKeys(bundle);
  if (!keys) {
    console.warn(`Skipping unrecognized artifact: ${bundle}`);
    continue;
  }
  const signature = readFileSync(path.join(args.dir, file), 'utf8').trim();
  for (const key of keys) {
    platforms[key] = {
      signature,
      url: `${baseUrl}/${bundle}`,
    };
  }
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
