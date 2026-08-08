// Central registry of the runtime environment variables the editor package
// reads. Cross-package flags live in `@myelin/shared/env`; app-only env vars
// live in the app's `src/lib/env.ts`.

export const PAGINATION_PROFILING =
  String(import.meta.env.VITE_PAGINATION_PROFILING ?? '').toLowerCase() ===
  'true';

// Injected by the app's vite.config from TAURI_ENV_PLATFORM, and by the bench.
// Declared here, not in vite-env.d.ts, which only this package's tsconfig sees.
declare const __MOBILE_BUILD__: boolean | undefined;

/** True for iOS and Android builds; false where nothing defines it. */
export const IS_MOBILE_BUILD =
  typeof __MOBILE_BUILD__ === 'boolean' ? __MOBILE_BUILD__ : false;
