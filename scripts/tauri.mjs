#!/usr/bin/env node
import { execSync, spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';

const PORT_ENV_VAR = 'MYELIN_TAURI_DEV_PORT';
const DEFAULT_TAURI_DEV_PORT = 1420;
const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

function readTauriDevPort(env) {
  const rawPort = env[PORT_ENV_VAR]?.trim();

  if (!rawPort) {
    return DEFAULT_TAURI_DEV_PORT;
  }

  const port = Number(rawPort);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`${PORT_ENV_VAR} must be an integer from 1 to 65535.`);
    process.exit(1);
  }

  return port;
}

const args = process.argv.slice(2);
const env = {
  ...process.env,
  ...loadEnv('development', rootDir, ''),
};
const port = readTauriDevPort(env);
const tauriArgs = [...args];

if (args[0] === 'dev' && port !== DEFAULT_TAURI_DEV_PORT) {
  tauriArgs.splice(
    1,
    0,
    '--config',
    JSON.stringify({ build: { devUrl: `http://localhost:${port}` } }),
  );
}

// Point dev builds at this branch's Cloudflare Pages preview, whose API talks to Polar's sandbox.
// Covers `dev`, `ios dev`, and `ios build --debug` (used by `yarn ios:device`).
const isDevBuild = args.includes('dev') || args.includes('--debug');
if (isDevBuild && !env.VITE_WEBSITE_URL) {
  const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: rootDir })
    .toString()
    .trim();
  // Only preview-* branches get a Pages preview deployment.
  if (branch.startsWith('preview-')) {
    // Cloudflare's branch alias rule: lowercase, non-alphanumerics to '-', max 28 chars.
    const alias = branch
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .slice(0, 28);
    env.VITE_WEBSITE_URL = `https://${alias}.myelin-3lc.pages.dev`;
  }
}

const child = spawn(
  process.execPath,
  [
    path.join(rootDir, 'node_modules', '@tauri-apps', 'cli', 'tauri.js'),
    ...tauriArgs,
  ],
  {
    cwd: rootDir,
    env,
    stdio: 'inherit',
  },
);

child.on('error', (error) => {
  console.error(error);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
