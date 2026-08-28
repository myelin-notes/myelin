import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@myelin/editor/i18n/messages/en';
import { LocalRepository } from '@/lib/sync/repo/local';
import {
  getRepositoryTestStorage,
  resetRepositoryTestDoubles,
} from '@/test/repository-test-utils';
import { filesProvider } from './files';

vi.mock('@myelin/editor/pdf-renderer', () => ({
  createDefaultPdfPageOrder: (pageCount: number) =>
    Array.from({ length: pageCount }, (_, originalIndex) => ({
      kind: 'pdf',
      originalIndex,
    })),
  getPdfPageSizes: vi.fn(async () => [{ w: 680, h: 880 }]),
}));

function markdownFile(name: string, body: string): File {
  return new File([body], name, { type: 'text/markdown' });
}

function createJob(files: File[], repository: LocalRepository) {
  return filesProvider.createJob({
    selection: { kind: 'files', files },
    repository,
    parentId: null,
    strings: en,
  });
}

describe('files import provider', () => {
  beforeEach(() => {
    resetRepositoryTestDoubles();
  });

  it('previews supported files and flags the unsupported ones', async () => {
    getRepositoryTestStorage();
    const repository = new LocalRepository('files-provider-preview');

    const job = createJob(
      [
        markdownFile('Notes.md', '# Notes'),
        new File([new Uint8Array([1, 2])], 'photo.png', { type: 'image/png' }),
        new File([new Uint8Array([3])], 'archive.xyz', { type: '' }),
      ],
      repository,
    );

    const preview = await job.scan();

    expect(preview.lines.map((line) => line.icon)).toEqual(['note', 'media']);
    expect(preview.isEmpty).toBe(false);
    // Loose files land straight in the parent, so there is no root to conflict.
    expect(preview.conflict).toBeNull();
    expect(preview.skippedText).toBeTruthy();
  });

  it('imports supported files and reports counts', async () => {
    getRepositoryTestStorage();
    const repository = new LocalRepository('files-provider-import');

    const job = createJob(
      [
        markdownFile('First.md', '# First'),
        markdownFile('Second.md', '# Second'),
        new File([new Uint8Array([3])], 'archive.xyz', { type: '' }),
      ],
      repository,
    );

    await job.scan();
    const progress: number[] = [];
    const summary = await job.run({
      conflictResolution: 'rename',
      onProgress: (update) => progress.push(update.current),
    });

    expect(summary.stats).toEqual({ count: 2, skipped: 1 });
    expect(progress).toEqual([1, 2]);

    const [, files] = await repository.listDirectory(null);
    expect(files.map((file) => file.name).sort()).toEqual(['First', 'Second']);
  });

  it('reports an empty preview when nothing is importable', async () => {
    getRepositoryTestStorage();
    const repository = new LocalRepository('files-provider-empty');

    const job = createJob(
      [new File([new Uint8Array([1])], 'archive.xyz', { type: '' })],
      repository,
    );

    expect((await job.scan()).isEmpty).toBe(true);
  });

  it('refuses to run before scanning', async () => {
    getRepositoryTestStorage();
    const repository = new LocalRepository('files-provider-unscanned');

    await expect(
      createJob([markdownFile('A.md', '# A')], repository).run({
        conflictResolution: 'rename',
        onProgress: () => {},
      }),
    ).rejects.toThrow('Must scan before importing');
  });
});
