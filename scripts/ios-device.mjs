#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const tauriConfig = JSON.parse(
  readFileSync(path.join(rootDir, 'src-tauri', 'tauri.conf.json'), 'utf8'),
);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: 'inherit',
    ...options,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${command} exited with code ${result.status ?? 1}.`);
  }
}

function findConnectedDevice() {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'myelin-ios-device-'));
  const outputPath = path.join(tempDir, 'devices.json');

  try {
    run('xcrun', [
      'devicectl',
      'list',
      'devices',
      '--quiet',
      '--timeout',
      '30',
      '--json-output',
      outputPath,
    ]);

    const output = JSON.parse(readFileSync(outputPath, 'utf8'));
    const devices = (output.result?.devices ?? []).filter(
      (device) =>
        device.hardwareProperties?.platform === 'iOS' &&
        device.hardwareProperties?.reality === 'physical' &&
        device.connectionProperties?.transportType === 'wired' &&
        device.connectionProperties?.tunnelState === 'connected',
    );

    if (devices.length !== 1) {
      throw new Error(
        `Expected one connected USB iPhone or iPad, found ${devices.length}.`,
      );
    }

    return devices[0];
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function findAppBundle() {
  const buildDir = path.join(rootDir, 'src-tauri', 'gen', 'apple', 'build');
  const bundleName = `${tauriConfig.productName}.app`;
  const appBundles = readdirSync(buildDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.endsWith('.xcarchive'))
    .map((entry) =>
      path.join(buildDir, entry.name, 'Products', 'Applications', bundleName),
    )
    .filter(existsSync)
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);

  if (appBundles.length === 0) {
    throw new Error(`Could not find ${bundleName} in an Xcode archive.`);
  }

  return appBundles[0];
}

try {
  const device = findConnectedDevice();
  console.log(`Using ${device.deviceProperties.name} (${device.identifier})`);

  run(
    'yarn',
    ['tauri', 'ios', 'build', '--debug', '--export-method', 'debugging'],
    {
      env: {
        ...process.env,
        SOURCE_DATE_EPOCH: process.env.SOURCE_DATE_EPOCH ?? '1704067200',
      },
    },
  );

  const appBundle = findAppBundle();
  run('xcrun', [
    'devicectl',
    'device',
    'install',
    'app',
    '--device',
    device.identifier,
    appBundle,
  ]);
  run('xcrun', [
    'devicectl',
    'device',
    'process',
    'launch',
    '--device',
    device.identifier,
    tauriConfig.identifier,
  ]);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
