import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  site: 'https://trymyelin.app',
  integrations: [sitemap(), react()],
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    // @myelin/editor is a linked workspace package consumed as raw .ts source,
    // so vite dev otherwise serves its ~135 modules individually — a long
    // client-side ESM waterfall before the canvas island can run. Pre-bundle the
    // editor entry points the site imports so the browser fetches a handful of
    // esbuild chunks instead of hundreds of files.
    optimizeDeps: {
      entries: ['src/canvas/CanvasEditor.tsx'],
      // pdfjs is loaded lazily at runtime (only when a PDF renders) and uses a
      // `?url` worker import esbuild's optimizer can't process, so keep it out
      // of the pre-bundle. It's absent from the editor's static graph anyway.
      exclude: ['pdfjs-dist'],
      include: [
        '@myelin/editor/drawable-canvas',
        '@myelin/editor/ydoc-manager',
        '@myelin/editor/render-loop',
        '@myelin/editor/tools/tool',
        '@myelin/editor/user-prefs',
      ],
    },
  },
});
