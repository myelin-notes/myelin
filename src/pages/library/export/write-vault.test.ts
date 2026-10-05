import * as scoped from 'tauri-plugin-scoped-storage-api';
import { beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import type { PickedFolder } from '@/lib/folder-picker';
import {
  getRepositoryTestStorage,
  resetRepositoryTestDoubles,
} from '@/test/repository-test-utils';
import { writeVault } from './write-vault';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

vi.mock('tauri-plugin-scoped-storage-api', () => ({
  exists: vi.fn(),
  mkdir: vi.fn(),
  writeTextFile: vi.fn(),
  writeFile: vi.fn(),
  removeDir: vi.fn(),
}));

const folder: PickedFolder = { kind: 'scoped', handle: { id: 'destination' } };
beforeEach(() => {
  resetRepositoryTestDoubles();
  vi.resetAllMocks();
  vi.mocked(scoped.exists).mockResolvedValue(false);
});

it('keeps desktop exports on the existing Rust writer', async () => {
  vi.mocked(invoke).mockResolvedValue('/exports/Vault');
  expect(
    await writeVault({
      destDir: { kind: 'native', path: '/exports' },
      vaultName: 'Vault',
      folders: [],
      files: [],
    }),
  ).toBe('/exports/Vault');
  expect(invoke).toHaveBeenCalledWith('export_obsidian_vault', {
    request: {
      destDir: '/exports',
      vaultName: 'Vault',
      folders: [],
      files: [],
    },
  });
  expect(scoped.mkdir).not.toHaveBeenCalled();
});

it('preserves existing exports and writes nested text, empty folders, and local media on mobile', async () => {
  vi.mocked(scoped.exists)
    .mockResolvedValueOnce(true)
    .mockResolvedValueOnce(false);
  const bytes = new Uint8Array([4, 5, 6]);
  await getRepositoryTestStorage().writeFile('/local/image.png', bytes);
  expect(
    await writeVault({
      destDir: folder,
      vaultName: 'Vault',
      folders: ['Empty'],
      files: [
        { relPath: 'Nested/Note.md', text: '' },
        { relPath: 'image.png', copyFrom: '/local/image.png' },
      ],
    }),
  ).toBe('Vault (2)');
  expect(scoped.mkdir).toHaveBeenCalledWith(
    'destination',
    'Vault (2)/Empty',
    true,
  );
  expect(scoped.writeTextFile).toHaveBeenCalledWith(
    'destination',
    'Vault (2)/Nested/Note.md',
    '',
    { recursive: true },
  );
  expect(scoped.writeFile).toHaveBeenCalledWith(
    'destination',
    'Vault (2)/image.png',
    bytes,
    { recursive: true },
  );
});

it('removes only the new export folder when a write fails', async () => {
  const error = new Error('write failed');
  vi.mocked(scoped.writeTextFile).mockRejectedValue(error);
  vi.mocked(scoped.removeDir).mockResolvedValue();
  await expect(
    writeVault({
      destDir: folder,
      vaultName: 'Vault',
      folders: [],
      files: [{ relPath: 'Note.json', text: '{}' }],
    }),
  ).rejects.toBe(error);
  expect(scoped.removeDir).toHaveBeenCalledWith('destination', 'Vault', true);
});
