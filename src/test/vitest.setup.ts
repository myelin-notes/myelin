import { beforeEach, vi } from 'vitest';

// The `node` test environment has no DOMRect. Provide a minimal stand-in so
// canvas elements that compute geometry (localBoundingBox / boundingBox) can be
// unit-tested without a full DOM.
if (typeof globalThis.DOMRect === 'undefined') {
  class DOMRectPolyfill {
    public readonly left: number;
    public readonly top: number;
    public readonly right: number;
    public readonly bottom: number;
    public constructor(
      public readonly x = 0,
      public readonly y = 0,
      public readonly width = 0,
      public readonly height = 0,
    ) {
      this.left = Math.min(x, x + width);
      this.top = Math.min(y, y + height);
      this.right = Math.max(x, x + width);
      this.bottom = Math.max(y, y + height);
    }
  }
  Object.defineProperty(globalThis, 'DOMRect', {
    configurable: true,
    value: DOMRectPolyfill,
  });
}

// StrokeElement allocates a Path2D in its constructor for on-screen rendering.
// The `node` environment has none; a no-op stand-in lets stroke geometry be
// unit-tested without a canvas (draw2D is never exercised in those tests).
if (typeof globalThis.Path2D === 'undefined') {
  class Path2DPolyfill {}
  Object.defineProperty(globalThis, 'Path2D', {
    configurable: true,
    value: Path2DPolyfill,
  });
}

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
  clearAllThumbnails: async () => {},
  getThumbnailUrl: async () => null,
  regenerateThumbnailNow: async () => {},
  registerThumbnailProducer: () => () => {},
  removeThumbnail: async () => {},
  requestThumbnailRegeneration: () => {},
  subscribeThumbnail: () => () => {},
}));

vi.mock('@/lib/note-index', () => ({
  noteIndexService: {
    init: async () => {},
    reset: () => {},
    getContent: () => new Map<string, string>(),
    getEmbeddings: () => new Map<string, unknown>(),
    embedSearchQuery: async () => ({ model: 'test', dim: 0, vector: [] }),
    requestReindex: () => {},
    startBackfill: () => {},
    removeIndex: async () => {},
  },
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
