// Central registry of runtime environment variables.
//
// All `import.meta.env.*` reads in the app should live here so we have a
// single place to audit which env vars the app depends on.
//
// Build-time env vars consumed by vite.config.ts (Node context, `process.env`)
// are documented here for discoverability but must be read there directly:
//   - MYELIN_TAURI_DEV_PORT — dev server port override, defaults to 1420
//   - TAURI_DEV_HOST       — host override for the Tauri dev server
//
// These are non-secret, client-embedded values (OAuth client id, public
// PostHog key, discovery URL), so the production defaults are baked in below.
// An env var, when set, overrides the default — useful for local overrides.
//
// Runtime Vite env vars:
//   - VITE_GITHUB_CLIENT_ID — GitHub OAuth client id
//   - VITE_LIVE_DISCOVERY_URL — Cloudflare Worker URL for automatic live sync
//     peer discovery
//   - VITE_POSTHOG_KEY  — PostHog project API key
//   - VITE_POSTHOG_HOST — PostHog ingestion host, defaults to us.i.posthog.com

export const IS_DEV = import.meta.env.DEV;
export const MODE = import.meta.env.MODE;

export const GITHUB_CLIENT_ID = (
  import.meta.env.VITE_GITHUB_CLIENT_ID ?? 'Ov23lio3GBRJhHIcx6ow'
).trim();

export const LIVE_DISCOVERY_URL = (
  import.meta.env.VITE_LIVE_DISCOVERY_URL ??
  'https://live.trymyelin.app'
)
  .trim()
  .replace(/\/+$/, '');

export const PERSIST_DEBUG_LOGS =
  String(import.meta.env.VITE_PERSIST_DEBUG_LOGS ?? '').toLowerCase() ===
  'true';

export const PAGINATION_PROFILING =
  String(import.meta.env.VITE_PAGINATION_PROFILING ?? '').toLowerCase() ===
  'true';

export const POSTHOG_KEY = (
  import.meta.env.VITE_POSTHOG_KEY ??
  'phc_skVas2x5YjFtHDNKeaTrDXvb4V4homydUXaG5hNwBdiL'
).trim();

export const POSTHOG_HOST = (
  import.meta.env.VITE_POSTHOG_HOST ?? 'https://us.i.posthog.com'
)
  .trim()
  .replace(/\/+$/, '');
