/**
 * The build this bundle came from, stamped in by vite. @see ../vite.config.ts
 *
 * A device reloads bench URLs by hand between builds, and a browser that serves
 * a cached page reports a stale run indistinguishably from a fresh one — which
 * has already happened once and cost a round trip. Carried on screen and in the
 * posted payload so the question "is this the build I just made" has an answer.
 */
declare const __BENCH_BUILD__: string;

export const BUILD_ID: string =
  typeof __BENCH_BUILD__ === 'string' ? __BENCH_BUILD__ : 'dev';
