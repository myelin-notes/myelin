import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@myelin/editor/i18n/messages/en';
import {
  getRepositoryTestStorage,
  resetRepositoryTestDoubles,
} from '@/test/repository-test-utils';
import { TestRepository } from '@/test/test-repository';
import { filesProvider } from './files';

vi.mock('@myelin/editor/pdf-renderer', () => ({
  createDefaultPdfPageOrder: (pageCount: number) =>
    Array.from({ length: pageCount }, (_, originalIndex) => ({
      kind: 'pdf',
      originalIndex,
    })),
  getPdfPageSizes: vi.fn(async () => [{ w: 680, h: 880 }]),
}));

function createJob(paths: string[], repository: TestRepository) {
  return filesProvider.createJob({
    selection: { kind: 'native-files', paths },
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
    const repository = new TestRepository('files-provider-preview');

    const job = createJob(
      ['/picked/Notes.md', '/picked/photo.png', '/picked/archive.xyz'],
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
    const storage = getRepositoryTestStorage();
    await storage.writeFile(
      '/picked/First.md',
      new TextEncoder().encode('# First'),
    );
    await storage.writeFile(
      '/picked/Second.md',
      new TextEncoder().encode('# Second'),
    );
    const repository = new TestRepository('files-provider-import');

    const job = createJob(
      ['/picked/First.md', '/picked/Second.md', '/picked/archive.xyz'],
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
    const repository = new TestRepository('files-provider-empty');

    const job = createJob(['/picked/archive.xyz'], repository);

    expect((await job.scan()).isEmpty).toBe(true);
  });

  it('refuses to run before scanning', async () => {
    getRepositoryTestStorage();
    const repository = new TestRepository('files-provider-unscanned');

    await expect(
      createJob(['/picked/A.md'], repository).run({
        conflictResolution: 'rename',
        onProgress: () => {},
      }),
    ).rejects.toThrow('Must scan before importing');
  });
});
