import { beforeEach, describe, expect, it, vi } from 'vitest';
import { yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror';
import en from '@myelin/editor/i18n/messages/en';
import { schema } from '@myelin/editor/page-frame/pm/schema';
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

  it('imports a Jupyter notebook as a page frame of its cells', async () => {
    const storage = getRepositoryTestStorage();
    const notebook = {
      metadata: { kernelspec: { language: 'python' } },
      cells: [
        { cell_type: 'markdown', source: ['# Analysis\n', 'Some notes'] },
        { cell_type: 'code', source: 'print("```")\n', outputs: [] },
        { cell_type: 'code', source: [], outputs: [] },
      ],
    };
    await storage.writeFile(
      '/picked/Analysis.ipynb',
      new TextEncoder().encode(JSON.stringify(notebook)),
    );
    const repository = new TestRepository('files-provider-jupyter');

    const job = createJob(['/picked/Analysis.ipynb'], repository);
    expect((await job.scan()).isEmpty).toBe(false);
    await job.run({ conflictResolution: 'rename', onProgress: () => {} });

    const [, files] = await repository.listDirectory(null);
    expect(files.map((file) => file.name)).toEqual(['Analysis']);
    const session = await repository.openSession(files[0].id);
    try {
      const uuid = session.ydoc.elements.get(0).get('uuid') as string;
      const doc = yXmlFragmentToProseMirrorRootNode(
        session.ydoc.getXmlFragment(uuid),
        schema,
      );
      const blocks = doc.children.map((node) => [
        node.type.name,
        node.textContent,
      ]);
      expect(blocks).toEqual([
        ['heading', 'Analysis'],
        ['paragraph', 'Some notes'],
        ['codeBlock', '```python\nprint("```")\n```'],
      ]);
    } finally {
      await session.close();
    }
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
