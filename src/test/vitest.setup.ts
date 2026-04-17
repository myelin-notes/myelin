import { vi } from 'vitest';

vi.mock('@/lib/thumbnail-cache', () => ({
  ThumbnailCache: {
    remove: async () => {},
    save: async () => {},
    getUrl: async () => null,
  },
}));

vi.mock('@/lib/sync/repo/github-credentials', () => ({
  getGitHubToken: async () => 'test-token',
}));

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (path: string) => path,
}));

vi.mock('@tauri-apps/api/path', async () => {
  const { createPathModule } = await import('./repository-test-utils');
  return createPathModule();
});

vi.mock('@tauri-apps/plugin-fs', async () => {
  const { createPluginFsModule } = await import('./repository-test-utils');
  return createPluginFsModule();
});

vi.mock('@tauri-apps/plugin-http', async () => {
  const { createPluginHttpModule } = await import('./repository-test-utils');
  return createPluginHttpModule();
});
