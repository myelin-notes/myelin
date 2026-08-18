// Central registry of runtime environment variables.
//
// All `import.meta.env.*` reads in the app should live here
//
// Build-time env vars consumed by vite.config.ts (Node context, `process.env`)
// documented here for discoverability but must be read there directly:
//   - MYELIN_TAURI_DEV_PORT — dev server port override, defaults to 1420
//   - TAURI_DEV_HOST       — host override for the Tauri dev server
//
// Runtime Vite env vars:
//   - VITE_GITHUB_CLIENT_ID — GitHub OAuth client id
//   - VITE_GITHUB_CLIENT_SECRET — GitHub OAuth client secret
//   - VITE_LIVE_DISCOVERY_URL — Cloudflare Worker URL for automatic live sync
//     peer discovery
//   - VITE_POSTHOG_KEY  — PostHog project API key
//   - VITE_POSTHOG_HOST — PostHog ingestion host, defaults to us.i.posthog.com

export const IS_DEV = import.meta.env.DEV;
export const MODE = import.meta.env.MODE;

// Baked in at build time by vite.config.ts through a `define` global (not an
// import.meta.env read): true for iOS and Android app builds, or when
// VITE_TABLET_LAYOUT is set for local preview. Selects the full-page mobile
// library layout over the desktop sidebar, at every mobile viewport size —
// see SidebarProvider.
export const IS_MOBILE_BUILD = __MOBILE_BUILD__;

export const GITHUB_CLIENT_ID = (
  import.meta.env.VITE_GITHUB_CLIENT_ID ?? 'Ov23lio3GBRJhHIcx6ow'
).trim();

export const GITHUB_CLIENT_SECRET =
  import.meta.env.VITE_GITHUB_CLIENT_SECRET.trim();

export const LIVE_DISCOVERY_URL = (
  import.meta.env.VITE_LIVE_DISCOVERY_URL ?? 'https://live.trymyelin.app'
)
  .trim()
  .replace(/\/+$/, '');

export const POSTHOG_KEY = (
  import.meta.env.VITE_POSTHOG_KEY ??
  'phc_skVas2x5YjFtHDNKeaTrDXvb4V4homydUXaG5hNwBdiL'
).trim();

export const POSTHOG_HOST = (
  import.meta.env.VITE_POSTHOG_HOST ?? 'https://us.i.posthog.com'
)
  .trim()
  .replace(/\/+$/, '');
