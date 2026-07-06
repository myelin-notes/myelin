// Central registry of the runtime environment variables the editor package
// reads. App-only env vars live in the app's `src/lib/env.ts`.

export const IS_DEV = import.meta.env.DEV;

export const PERSIST_DEBUG_LOGS =
  String(import.meta.env.VITE_PERSIST_DEBUG_LOGS ?? '').toLowerCase() ===
  'true';

export const PAGINATION_PROFILING =
  String(import.meta.env.VITE_PAGINATION_PROFILING ?? '').toLowerCase() ===
  'true';
