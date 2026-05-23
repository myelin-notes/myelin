import { beforeEach, vi } from 'vitest';

const memoryLocalStorage = new Map<string, string>();

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem(key: string) {
      return memoryLocalStorage.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      memoryLocalStorage.set(key, value);
    },
    removeItem(key: string) {
      memoryLocalStorage.delete(key);
    },
    clear() {
      memoryLocalStorage.clear();
    },
    key(index: number) {
      return Array.from(memoryLocalStorage.keys())[index] ?? null;
    },
    get length() {
      return memoryLocalStorage.size;
    },
  } satisfies Storage,
});

beforeEach(() => {
  memoryLocalStorage.clear();
});

vi.mock('@/lib/thumbnails', () => ({
  getThumbnailUrl: async () => null,
  regenerateThumbnailNow: async () => {},
  registerThumbnailProducer: () => () => {},
  removeThumbnail: async () => {},
  requestThumbnailRegeneration: () => {},
  subscribeThumbnail: () => () => {},
}));

vi.mock('@/lib/sync/repo/github-credentials', () => ({
  getGitHubToken: vi.fn(async () => 'test-token'),
  hasGitHubToken: vi.fn(async () => true),
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
