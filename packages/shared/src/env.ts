// Central registry of the runtime environment variables the shared package
// reads. App-only env vars live in the app's `src/lib/env.ts`.

export const IS_DEV = import.meta.env.DEV;

export const PERSIST_DEBUG_LOGS =
  String(import.meta.env.VITE_PERSIST_DEBUG_LOGS ?? '').toLowerCase() ===
  'true';
