import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  site: 'https://trymyelin.app',
  // English is unprefixed (`/`), every other locale sits under its own segment
  // (`/es/`, `/zh-hans/`). Route segments stay lowercase; the BCP 47 tags that
  // `<html lang>` and hreflang need live in `src/lib/locale.ts`.
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'es', 'zh-hans'],
    routing: { prefixDefaultLocale: false },
  },
  integrations: [
    // Groups each page with its translations in the sitemap, so a crawler that
    // finds one language is told about the others.
    sitemap({
      i18n: {
        defaultLocale: 'en',
        locales: { en: 'en', es: 'es', 'zh-hans': 'zh-Hans' },
      },
    }),
    react(),
  ],
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
