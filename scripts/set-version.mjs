#!/usr/bin/env node
// Stamp a release version into the three files that carry it: package.json
// (which tauri.conf.json references), src-tauri/Cargo.toml, and Cargo.lock.
// The repo permanently stores 0.0.0 to mark dev builds; CI runs this with the
// version derived from the release tag before building.
//
// Usage:
//   node scripts/set-version.mjs <version>
import { readFileSync, writeFileSync } from 'node:fs';

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error(`Invalid or missing version: '${version ?? ''}'`);
  process.exit(1);
}

const pkgPath = 'package.json';
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
pkg.version = version;
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

// Replace only the [package] version, i.e. the first `version = "..."` line —
// dependency entries further down also match the pattern.
const cargoTomlPath = 'src-tauri/Cargo.toml';
const cargoToml = readFileSync(cargoTomlPath, 'utf8');
writeFileSync(
  cargoTomlPath,
  cargoToml.replace(/^version = ".*"$/m, `version = "${version}"`),
);

// Keep Cargo.lock's own-package entry in sync so builds don't dirty it.
const cargoLockPath = 'src-tauri/Cargo.lock';
const cargoLock = readFileSync(cargoLockPath, 'utf8');
writeFileSync(
  cargoLockPath,
  cargoLock.replace(
    /(\[\[package\]\]\nname = "myelin"\nversion = )".*"/,
    `$1"${version}"`,
  ),
);

console.log(`Version set to ${version}`);
