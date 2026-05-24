// Central registry of runtime environment variables.
//
// All `import.meta.env.*` reads in the app should live here so we have a
// single place to audit which env vars the app depends on.
//
// Build-time env vars consumed by vite.config.ts (Node context, `process.env`)
// are documented here for discoverability but must be read there directly:
//   - MYELIN_TAURI_DEV_PORT — dev server port override, defaults to 1420
//   - TAURI_DEV_HOST       — host override for the Tauri dev server
//   - SENTRY_AUTH_TOKEN    — upload source maps to Sentry during build
//
// Runtime Vite env vars:
//   - VITE_LIVE_DISCOVERY_URL — optional Cloudflare Worker URL for automatic
//     live sync peer discovery

export const IS_DEV = import.meta.env.DEV;
export const MODE = import.meta.env.MODE;

export const GITHUB_CLIENT_ID = (
  import.meta.env.VITE_GITHUB_CLIENT_ID ?? ''
).trim();

export const LIVE_DISCOVERY_URL = (
  import.meta.env.VITE_LIVE_DISCOVERY_URL ?? ''
)
  .trim()
  .replace(/\/+$/, '');

export const PERSIST_DEBUG_LOGS =
  String(import.meta.env.VITE_PERSIST_DEBUG_LOGS ?? '').toLowerCase() ===
  'true';

export const PAGINATION_PROFILING =
  String(import.meta.env.VITE_PAGINATION_PROFILING ?? '').toLowerCase() ===
  'true';
