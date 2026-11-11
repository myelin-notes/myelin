#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const tauriConfig = JSON.parse(
  readFileSync(path.join(rootDir, 'src-tauri', 'tauri.conf.json'), 'utf8'),
);
const apkPath = path.join(
  rootDir,
  'src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk',
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

  return result;
}

function findConnectedDevice() {
  const { stdout } = run('adb', ['devices'], {
    stdio: ['ignore', 'pipe', 'inherit'],
    encoding: 'utf8',
  });
  const serials = stdout
    .split('\n')
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter(
      ([serial, state]) =>
        state === 'device' && !serial.startsWith('emulator-'),
    )
    .map(([serial]) => serial);

  if (serials.length !== 1) {
    throw new Error(
      `Expected one connected Android device with USB debugging authorized, found ${serials.length}.`,
    );
  }

  return serials[0];
}

try {
  const serial = findConnectedDevice();
  console.log(`Using ${serial}`);

  // whisper-rs-sys's build.rs checks the host OS, so on a Mac it links ggml-blas, which isn't
  // built for Android. An empty archive satisfies the linker; nothing references its symbols.
  const stubDir = path.join(
    rootDir,
    'src-tauri',
    'target',
    'android-link-stubs',
  );
  mkdirSync(stubDir, { recursive: true });
  writeFileSync(path.join(stubDir, 'libggml-blas.a'), '!<arch>\n');

  // Env mirrors .github/workflows/android-debug-build.yml; see it for why each is needed.
  // The version override replaces CI's set-version step without dirtying tracked files.
  run(
    'yarn',
    [
      'tauri',
      'android',
      'build',
      '--debug',
      '--apk',
      '--target',
      'aarch64',
      '--config',
      JSON.stringify({ version: '0.0.1' }),
    ],
    {
      env: {
        ...process.env,
        CARGO_ENCODED_RUSTFLAGS: `-Clink-arg=-Wl,-z,max-page-size=16384\x1f-L${stubDir}`,
        BINDGEN_EXTRA_CLANG_ARGS: `--sysroot=${process.env.NDK_HOME}/toolchains/llvm/prebuilt/darwin-x86_64/sysroot`,
        CARGO_PROFILE_DEV_DEBUG: '0',
        CARGO_PROFILE_DEV_OPT_LEVEL: '2',
        // libsodium's ./configure finds no `aarch64-linux-android-ar` and falls back to macOS ar,
        // which silently writes empty archives for ELF objects; the app then crashes on launch.
        AR: `${process.env.NDK_HOME}/toolchains/llvm/prebuilt/darwin-x86_64/bin/llvm-ar`,
        RANLIB: `${process.env.NDK_HOME}/toolchains/llvm/prebuilt/darwin-x86_64/bin/llvm-ranlib`,
      },
    },
  );

  if (!existsSync(apkPath)) {
    throw new Error(`Could not find ${apkPath}.`);
  }

  run('adb', ['-s', serial, 'install', '-r', '--user', 'current', apkPath]);
  run('adb', [
    '-s',
    serial,
    'shell',
    'am',
    'start',
    '-n',
    `${tauriConfig.identifier}/.MainActivity`,
  ]);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
