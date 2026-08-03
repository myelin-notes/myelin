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
export default defineConfig({
  root: __dirname,
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
  },
});
