import { fileURLToPath } from 'node:url';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

// The canvas experience mounts the real app's canvas engine (repo root `src/`)
// inside React islands. The engine's Tauri touchpoints are import-safe in a
// browser but are shimmed anyway so no desktop-only code ships to the site.
const appSrc = fileURLToPath(new URL('../../src', import.meta.url));
const shim = (name) =>
  fileURLToPath(
    new URL(`./src/canvas/tauri-shims/${name}.ts`, import.meta.url),
  );

// https://astro.build/config
export default defineConfig({
  site: 'https://trymyelin.app',
  integrations: [sitemap(), react()],
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: [
        { find: '@tauri-apps/api/core', replacement: shim('api-core') },
        { find: '@tauri-apps/api/path', replacement: shim('api-path') },
        { find: '@tauri-apps/api/event', replacement: shim('api-event') },
        { find: '@tauri-apps/plugin-fs', replacement: shim('plugin-fs') },
        { find: '@tauri-apps/plugin-http', replacement: shim('plugin-http') },
        {
          find: '@tauri-apps/plugin-dialog',
          replacement: shim('plugin-dialog'),
        },
        {
          find: '@tauri-apps/plugin-opener',
          replacement: shim('plugin-opener'),
        },
        { find: '@', replacement: appSrc },
      ],
    },
  },
});
