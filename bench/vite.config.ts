import path from 'node:path';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { resultSink } from './result-sink';

// The bench mounts the real editor package from source, so it needs the same
// transform pipeline the app uses: the editor's entry graph reaches .tsx files
// (audio element, frame chrome) and its stylesheet is Tailwind.
//
// The React Compiler babel plugin is deliberately NOT enabled here. The bench
// measures the engine's render loop, which is plain TypeScript; adding a
// compiler pass would only change how the few React leaves behave and make
// bench numbers diverge from the code under test for no gain.
/**
 * Which build a page came from, stamped in at build time.
 *
 * A tablet reloading a bench URL is the one part of this loop nobody can see.
 * Safari held a finished run on screen across a rebuild once, and the table it
 * was showing was old — indistinguishable from a fresh one, and reported as a
 * result. Every run now carries the build that produced it, so a stale page is
 * a fact on the screen and in the posted payload rather than a suspicion.
 */
const BUILD_ID = new Date().toISOString().slice(11, 19);

export default defineConfig({
  root: __dirname,
  define: {
    __BENCH_BUILD__: JSON.stringify(BUILD_ID),
    // The bench stands in for the tablet build, which is the only one that
    // takes the background layer down during a zoom. Unset, every zoom case
    // would silently measure a configuration no tablet runs.
    __MOBILE_BUILD__: 'true',
  },
  plugins: [react(), tailwindcss(), resultSink(__dirname)],
  resolve: {
    alias: {
      '@bench': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 1430,
    strictPort: true,
  },
  // The driver measures a production build, never the dev server: dev serves
  // unbundled ESM and React's development build, which is a different amount
  // of work per frame than what ships.
  preview: {
    // Bound on all interfaces rather than `localhost`, for two reasons: on
    // Windows `localhost` can bind IPv6-only, which the driver (and Chrome)
    // cannot reach at 127.0.0.1; and a tablet on the same network has to be
    // able to load this, which is the only way to measure the real engine on
    // the real GPU without a signed build.
    host: true,
    port: 1431,
    strictPort: true,
    // Safari will otherwise hold `index.html` across a rebuild, and the hashed
    // bundle it names is gone the moment anything is rebuilt. The device is
    // reloading this by hand between builds — the whole workflow depends on a
    // reload actually fetching.
    headers: { 'Cache-Control': 'no-store' },
  },
});
