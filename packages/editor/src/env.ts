// Central registry of the runtime environment variables the editor package
// reads. Cross-package flags live in `@myelin/shared/env`; app-only env vars
// live in the app's `src/lib/env.ts`.

export const PAGINATION_PROFILING =
  String(import.meta.env.VITE_PAGINATION_PROFILING ?? '').toLowerCase() ===
  'true';
