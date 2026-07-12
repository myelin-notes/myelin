import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // Tests run against the desktop layout; the tablet build flag (injected by
  // vite.config.ts in real builds) is absent here, so define it explicitly.
  define: {
    __TABLET_BUILD__: JSON.stringify(false),
  },
  test: {
    environment: 'node',
    setupFiles: ['./src/test/vitest.setup.ts'],
  },
});
