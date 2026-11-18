import { expect, it, vi } from 'vitest';
import { artifactCache } from './artifact-cache';

const files = new Set<string>();

// Mirrors tauri-plugin-fs: `remove` on a missing path rejects instead of no-oping.
vi.mock('@tauri-apps/plugin-fs', () => ({
  BaseDirectory: { AppCache: 'AppCache' },
  exists: async (path: string) => files.has(path),
  remove: async (path: string) => {
    await Promise.resolve();
    if (!files.delete(path)) {
      throw `failed to get metadata of path: ${path} with error: The system cannot find the file specified. (os error 2)`;
    }
  },
}));

it('concurrent removes of the same path both resolve', async () => {
  files.add('thumbnails/a.png');

  await expect(
    Promise.all([
      artifactCache.remove('thumbnails/a.png'),
      artifactCache.remove('thumbnails/a.png'),
    ]),
  ).resolves.toBeDefined();
  expect(files.has('thumbnails/a.png')).toBe(false);
});
