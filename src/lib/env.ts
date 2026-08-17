// Central registry of runtime environment variables.
//
// All `import.meta.env.*` reads in the app should live here so we have a
// single place to audit which env vars the app depends on. The editor and
// shared packages read their own flags in `packages/editor/src/env.ts` and
// `packages/shared/src/env.ts` — keep any shared flag semantics in sync with
// those files.
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
//   - VITE_GOOGLE_CLIENT_ID — Google OAuth client id for Drive sync. Google
//     issues OAuth clients per platform, so this must be the id of the
//     *Desktop app* client (only those accept the loopback redirect the PKCE
//     flow uses). No client secret is used or needed: PKCE replaces it.
//     VITE_GOOGLE_CLIENT_ID_IOS / VITE_GOOGLE_CLIENT_ID_ANDROID hold the iOS
//     and Android clients of the same project, used instead on those builds;
//     they redirect through the app's custom URI scheme, which the deep-link
//     plugin registers (see google-drive-credentials.ts).
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
// The mobile OS
export const MOBILE_PLATFORM = __MOBILE_PLATFORM__;

export const GITHUB_CLIENT_ID = (
  import.meta.env.VITE_GITHUB_CLIENT_ID ?? 'Ov23lio3GBRJhHIcx6ow'
).trim();

// No production default yet — the Cloud project's Desktop client is being
// created separately. Until it is set, Google Drive sign-in reports itself as
// unavailable instead of failing mid-flow.
export const GOOGLE_CLIENT_ID = (
  import.meta.env.VITE_GOOGLE_CLIENT_ID ?? ''
).trim();

export const GOOGLE_CLIENT_ID_IOS = (
  import.meta.env.VITE_GOOGLE_CLIENT_ID_IOS ?? ''
).trim();

export const GOOGLE_CLIENT_ID_ANDROID = (
  import.meta.env.VITE_GOOGLE_CLIENT_ID_ANDROID ?? ''
).trim();

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
