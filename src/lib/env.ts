// Central registry of runtime environment variables. All `import.meta.env.*` reads live here.
//
// Build-time vars are read directly in vite.config.ts (Node `process.env`):
//   - MYELIN_TAURI_DEV_PORT — dev server port, defaults to 1420
//   - TAURI_DEV_HOST — host override for the Tauri dev server
//
// Runtime Vite vars:
//   - VITE_GITHUB_CLIENT_ID / VITE_GITHUB_CLIENT_SECRET
//   - VITE_GOOGLE_CLIENT_ID — must be a *Desktop app* client; only those accept the loopback
//     redirect the PKCE flow uses.
//   - VITE_GOOGLE_CLIENT_SECRET — Google rejects the token exchange without it even on PKCE.
//     Unused on mobile, where Google issues no secret for the iOS/Android client types;
//     VITE_GOOGLE_CLIENT_ID_IOS / VITE_GOOGLE_CLIENT_ID_ANDROID are used there instead and
//     redirect through the app's custom URI scheme (see google-drive-credentials.ts).
//   - VITE_LIVE_DISCOVERY_URL — Cloudflare Worker URL for live sync peer discovery
//   - VITE_POSTHOG_KEY / VITE_POSTHOG_HOST (defaults to us.i.posthog.com)

export const IS_DEV = import.meta.env.DEV;
export const MODE = import.meta.env.MODE;

// Baked in at build time by vite.config.ts via a `define` global, not an import.meta.env read:
// true for iOS/Android builds, or when VITE_TABLET_LAYOUT is set for local preview. Selects the
// full-page mobile library layout at every viewport size — see SidebarProvider.
export const IS_MOBILE_BUILD = __MOBILE_BUILD__;
// The mobile OS
export const MOBILE_PLATFORM = __MOBILE_PLATFORM__;

export const GITHUB_CLIENT_ID = (
  import.meta.env.VITE_GITHUB_CLIENT_ID ?? 'Ov23lio3GBRJhHIcx6ow'
).trim();

export const GITHUB_CLIENT_SECRET = (
  import.meta.env.VITE_GITHUB_CLIENT_SECRET ?? ''
).trim();

export const GOOGLE_CLIENT_ID = (
  import.meta.env.VITE_GOOGLE_CLIENT_ID ??
  '150843770497-9i6tupvq4g4o1vhrkjk4pqevb2kpemc4.apps.googleusercontent.com'
).trim();

export const GOOGLE_CLIENT_SECRET = (
  import.meta.env.VITE_GOOGLE_CLIENT_SECRET ?? ''
).trim();

export const GOOGLE_CLIENT_ID_IOS = (
  import.meta.env.VITE_GOOGLE_CLIENT_ID_IOS ??
  '150843770497-rr48hcanpqd6v40rhedd6ar38rfr5n3l.apps.googleusercontent.com'
).trim();

export const GOOGLE_CLIENT_ID_ANDROID = (
  import.meta.env.VITE_GOOGLE_CLIENT_ID_ANDROID ??
  '150843770497-e7ujhf3bpnl6i703lil10fadmb5jllpt.apps.googleusercontent.com'
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
