import path from 'node:path';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import svgr from 'vite-plugin-svgr';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';

const DEFAULT_TAURI_DEV_PORT = 1420;

function readTauriDevPort(env: Record<string, string>): number {
  const rawPort = env.MYELIN_TAURI_DEV_PORT?.trim();

  if (!rawPort) {
    return DEFAULT_TAURI_DEV_PORT;
  }

  const port = Number(rawPort);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      'MYELIN_TAURI_DEV_PORT must be an integer from 1 to 65535.',
    );
  }

  return port;
}

// https://vite.dev/config/
export default defineConfig(async ({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const host = env.TAURI_DEV_HOST;
  const port = readTauriDevPort(env);
  const hmrPort = port < 65535 ? port + 1 : port;

  // Tauri sets TAURI_ENV_PLATFORM when it invokes this build; on iOS we ship the
  // tablet full-page library layout instead of the desktop sidebar. Baked in as
  // a `define` global so the choice is fixed at build time. VITE_TABLET_LAYOUT
  // lets a desktop dev preview the layout without an iOS build.
  const isTabletBuild =
    process.env.TAURI_ENV_PLATFORM === 'ios' ||
    env.VITE_TABLET_LAYOUT === 'true';

  return {
    plugins: [
      {
        // Inject the standalone React DevTools bootstrap script before any
        // other <head> content so it installs __REACT_DEVTOOLS_GLOBAL_HOOK__
        // before @vitejs/plugin-react's React Refresh preamble runs.
        // Otherwise React Refresh installs a stub hook that breaks the
        // DevTools component tree and profiler.
        name: 'react-devtools',
        apply: 'serve',
        transformIndexHtml: {
          order: 'pre',
          handler(html: string) {
            return html.replace(
              '<head>',
              '<head>\n    <script src="http://localhost:8097"></script>',
            );
          },
        },
      } satisfies Plugin,
      react({
        babel: {
          plugins: ['babel-plugin-react-compiler'],
        },
      }),
      tailwindcss(),
      svgr(),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    build: {
      sourcemap: true,
    },

    define: {
      __TABLET_BUILD__: JSON.stringify(isTabletBuild),
    },

    // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
    //
    // 1. prevent Vite from obscuring rust errors
    clearScreen: false,
    // 2. tauri expects a fixed port, fail if that port is not available
    server: {
      port,
      strictPort: true,
      host: host,
      hmr: host
        ? {
            protocol: 'ws',
            host,
            port: hmrPort,
          }
        : undefined,
      watch: {
        // 3. tell Vite to ignore watching `src-tauri` and nested git
        // worktrees (separate checkouts under `.claude/worktrees/` whose
        // edits would otherwise trigger spurious full-reloads here).
        ignored: ['**/src-tauri/**', '**/.claude/worktrees/**'],
      },
    },
  };
});
