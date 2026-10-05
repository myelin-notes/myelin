import * as scoped from 'tauri-plugin-scoped-storage-api';
import { beforeEach, expect, it, vi } from 'vitest';
import type { PickedFolder } from '@/lib/folder-picker';
import { LocalRepository } from '@/lib/sync/repo/local';
import { resetRepositoryTestDoubles } from '@/test/repository-test-utils';
import { importObsidianVault } from './obsidian-vault';
import { importWorkspaceJson } from './workspace-json';

vi.mock('tauri-plugin-scoped-storage-api', () => ({
  readDir: vi.fn(),
  readTextFile: vi.fn(),
  readFile: vi.fn(),
}));

const folder: PickedFolder = {
  kind: 'scoped',
  handle: {
    id: 'mobile-folder',
    name: 'My Vault',
    uri: 'content://provider/tree/123',
  },
};
const bytes = new Uint8Array([1, 2, 3]);

beforeEach(() => {
  resetRepositoryTestDoubles();
  vi.clearAllMocks();
  vi.mocked(scoped.readFile).mockResolvedValue(bytes);
});

it.each([
  'obsidian',
  'json',
])('imports nested %s notes and media using the mobile folder handle', async (format) => {
  const noteName = format === 'obsidian' ? 'Note.md' : 'Note.json';
  vi.mocked(scoped.readDir).mockImplementation(async (id, path) => {
    expect(id).toBe('mobile-folder');
    if (path === '') {
      return [{ name: 'Nested', path: 'Nested', isDir: true, isFile: false }];
    }
    expect(path).toBe('Nested');
    return [noteName, 'image.png'].map((name) => ({
      name,
      path: `Nested/${name}`,
      isDir: false,
      isFile: true,
    }));
  });
  vi.mocked(scoped.readTextFile).mockResolvedValue(
    format === 'obsidian'
      ? '# Hello'
      : JSON.stringify({
          version: 1,
          name: 'Note',
          elements: [],
          tags: ['imported'],
        }),
  );
  const repository = new LocalRepository(`mobile-${format}`);
  const result =
    format === 'obsidian'
      ? await importObsidianVault({
          repository,
          parentId: null,
          vaultPath: folder,
        })
      : await importWorkspaceJson({
          repository,
          parentId: null,
          dirPath: folder,
        });

  expect(result.notesImported).toBe(1);
  expect(result.mediaImported).toBe(1);
  expect(scoped.readTextFile).toHaveBeenCalledWith(
    'mobile-folder',
    `Nested/${noteName}`,
  );
  expect(scoped.readFile).toHaveBeenCalledWith(
    'mobile-folder',
    'Nested/image.png',
  );
  const [roots] = await repository.listDirectory(null);
  expect(roots[0].name).toBe('My Vault');
  const [nested] = await repository.listDirectory(result.rootFolderId);
  expect(nested[0].name).toBe('Nested');
  const [, files] = await repository.listDirectory(nested[0].id);
  expect(files.map((file) => file.name).sort()).toEqual(['Note', 'image.png']);
  const media = files.find((file) => file.name === 'image.png')!;
  expect(await repository.readFileBytes(media.id)).toEqual(bytes);
});
