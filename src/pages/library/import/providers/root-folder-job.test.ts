import { beforeEach, describe, expect, it } from 'vitest';
import { LocalRepository } from '@/lib/sync/repo/local';
import {
  getRepositoryTestStorage,
  resetRepositoryTestDoubles,
} from '@/test/repository-test-utils';
import { createRootFolderImportJob } from './root-folder-job';

function createJob(repository: LocalRepository, rootName: string) {
  const created: string[] = [];

  const job = createRootFolderImportJob<{ items: number }>({
    title: 'Import',
    scanningLabel: 'Scanning...',
    emptyLabel: 'Nothing found',
    rootName,
    repository,
    parentId: null,
    scan: async () => ({ items: 1 }),
    preview: () => ({ lines: [], skippedText: null, isEmpty: false }),
    run: async ({ rootName: resolved }) => {
      created.push(resolved);
      return {
        focusNodeId: await repository.createFolder(resolved, null),
        text: 'done',
        skippedText: null,
      };
    },
  });

  return { job, created };
}

describe('root folder import job', () => {
  beforeEach(() => {
    resetRepositoryTestDoubles();
  });

  it('reports no conflict when the name is free', async () => {
    getRepositoryTestStorage();
    const repository = new LocalRepository('root-job-no-conflict');

    expect(
      (await createJob(repository, 'Notebook').job.scan()).conflict,
    ).toBeNull();
  });

  it('detects a same-named sibling case-insensitively', async () => {
    getRepositoryTestStorage();
    const repository = new LocalRepository('root-job-conflict');
    const existing = await repository.createFolder('Notebook', null);

    const preview = await createJob(repository, 'notebook').job.scan();

    expect(preview.conflict).toEqual({ nodeId: existing });
  });

  it('renames instead of duplicating when the user keeps both', async () => {
    getRepositoryTestStorage();
    const repository = new LocalRepository('root-job-rename');
    await repository.createFolder('Notebook', null);

    const { job, created } = createJob(repository, 'Notebook');
    await job.scan();
    await job.run({ conflictResolution: 'rename', onProgress: () => {} });

    expect(created[0]).not.toBe('Notebook');

    const [folders] = await repository.listDirectory(null);
    expect(folders).toHaveLength(2);
  });

  it('replaces the existing folder when the user chooses replace', async () => {
    getRepositoryTestStorage();
    const repository = new LocalRepository('root-job-replace');
    await repository.createFolder('Notebook', null);

    const { job, created } = createJob(repository, 'Notebook');
    await job.scan();
    await job.run({ conflictResolution: 'replace', onProgress: () => {} });

    expect(created[0]).toBe('Notebook');

    const [folders] = await repository.listDirectory(null);
    expect(folders.map((folder) => folder.name)).toEqual(['Notebook']);
  });

  it('refuses to run before scanning', async () => {
    getRepositoryTestStorage();
    const repository = new LocalRepository('root-job-unscanned');

    await expect(
      createJob(repository, 'Notebook').job.run({
        conflictResolution: 'rename',
        onProgress: () => {},
      }),
    ).rejects.toThrow('Must scan before importing');
  });
});
