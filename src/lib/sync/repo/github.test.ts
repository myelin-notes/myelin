import { beforeEach, describe, expect, it } from 'vitest';
import {
  createGzippedTar,
  createNoteState,
  getRepositoryTestGitHubApi,
  readNoteText,
  resetRepositoryTestDoubles,
} from '@/test/repository-test-utils';
import { GitHubRepository } from './github';
import { ManifestDocument } from './manifest-document';
import {
  createEmptyManifest,
  getNotePath,
  getStoredFilePath,
  MANIFEST_PATH,
} from './shared';

function createRepository() {
  return new GitHubRepository({
    owner: 'myelin',
    repo: 'notes',
    branch: 'main',
    credentialId: 'test-credential',
  });
}

function readManifest(api: { readBytes(path: string): Uint8Array | null }) {
  const bytes = api.readBytes(MANIFEST_PATH);
  return bytes ? ManifestDocument.fromBytes(bytes).getManifest() : null;
}

describe('GitHubRepository', () => {
  beforeEach(() => {
    resetRepositoryTestDoubles();
  });

  it('initializes missing manifest content as an empty repository', async () => {
    const repository = createRepository();
    const githubApi = getRepositoryTestGitHubApi();

    const stats = await repository.getStats();

    expect(stats).toEqual({
      totalFiles: 0,
      totalFolders: 0,
      totalTags: 0,
    });
    expect(readManifest(githubApi)).toEqual(createEmptyManifest());
  });

  it('writes manifest and note contents through the transport', async () => {
    const repository = createRepository();
    const githubApi = getRepositoryTestGitHubApi();

    const folderId = await repository.createFolder('Docs', null);
    const fileId = await repository.createFile(
      'Remote note',
      'mcanvas',
      folderId,
    );
    const note = createNoteState('hello github repository');

    await repository.pushUpdates(fileId, note.update, {
      baseRevision: null,
      localStateVector: note.stateVector,
    });

    const manifest = readManifest(githubApi);

    expect(manifest).not.toBeNull();
    expect(manifest?.nodes[folderId]?.name).toBe('Docs');
    expect(manifest?.nodes[fileId]?.parentId).toBe(folderId);
    expect(readNoteText(githubApi.readBytes(getNotePath(fileId)))).toBe(
      'hello github repository',
    );
  });

  it('stores video file bytes at their typed storage path', async () => {
    const repository = createRepository();
    const githubApi = getRepositoryTestGitHubApi();
    const bytes = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]);

    const fileId = await repository.createFile('Clip.mp4', 'mp4', null, bytes);

    const manifest = readManifest(githubApi);
    const storedBytes = githubApi.readBytes(
      getStoredFilePath({ id: fileId, fileType: 'mp4' }),
    );

    expect(manifest?.nodes[fileId]).toMatchObject({
      name: 'Clip.mp4',
      type: 'file',
      fileType: 'mp4',
    });
    expect(Array.from(storedBytes ?? [])).toEqual(Array.from(bytes));
    expect(Array.from((await repository.readFileBytes(fileId)) ?? [])).toEqual(
      Array.from(bytes),
    );
  });

  it('retries manifest writes after a conflict response', async () => {
    const repository = createRepository();
    const githubApi = getRepositoryTestGitHubApi();

    await repository.initialize();
    githubApi.failNextPut(MANIFEST_PATH);

    const folderId = await repository.createFolder('Retry folder', null);
    const manifest = readManifest(githubApi);

    expect(manifest).not.toBeNull();
    expect(manifest?.nodes[folderId]?.name).toBe('Retry folder');
  });

  it('persists every batched manifest mutation in one write', async () => {
    const repository = createRepository();
    const githubApi = getRepositoryTestGitHubApi();

    await repository.initialize();
    const putsBeforeBatch = githubApi.putCallCount;

    const [folderA, folderB] = await repository.batchManifestWrites(
      async () => [
        await repository.createFolder('A', null),
        await repository.createFolder('B', null),
      ],
    );

    const manifest = readManifest(githubApi);

    expect(manifest?.nodes[folderA]?.name).toBe('A');
    expect(manifest?.nodes[folderB]?.name).toBe('B');
    expect(githubApi.putCallCount - putsBeforeBatch).toBe(1);
  });

  it('merges a batch with the winning Yjs manifest after a flush conflict', async () => {
    const repository = createRepository();
    const other = createRepository();
    const githubApi = getRepositoryTestGitHubApi();

    await repository.initialize();

    let concurrentId = '';
    const [folderA, folderB] = await repository.batchManifestWrites(
      async () => {
        const a = await repository.createFolder('A', null);
        // Another client wins the race while this batch is still open, so the
        // flush writes against a stale sha.
        concurrentId = await other.createFolder('Concurrent', null);
        return [a, await repository.createFolder('B', null)];
      },
    );

    const manifest = readManifest(githubApi);

    expect(manifest?.nodes[folderA]?.name).toBe('A');
    expect(manifest?.nodes[folderB]?.name).toBe('B');
    expect(manifest?.nodes[concurrentId]?.name).toBe('Concurrent');
    expect(manifest?.children).toHaveLength(3);
    expect(manifest?.children).toEqual(
      expect.arrayContaining([concurrentId, folderA, folderB]),
    );
  });

  it('preserves a file concurrently added to a deleted folder', async () => {
    const repository = createRepository();
    const other = createRepository();
    const githubApi = getRepositoryTestGitHubApi();

    const folderId = await repository.createFolder('Doomed', null);

    let concurrentFileId = '';
    await repository.batchManifestWrites(async () => {
      // Deleted while the folder is still empty as far as this batch knows.
      await repository.deleteNode(folderId);
      // Another client adds a file inside it and wins the race, so the flush
      // conflicts and the replayed delete removes a node this batch never saw.
      concurrentFileId = await other.createFile(
        'Inside.mp4',
        'mp4',
        folderId,
        new Uint8Array([4, 5, 6]),
      );
    });

    const manifest = readManifest(githubApi);

    expect(manifest?.nodes[folderId]).toBeUndefined();
    expect(manifest?.nodes[concurrentFileId]?.parentId).toBeNull();
    expect(manifest?.children).toContain(concurrentFileId);
    expect(
      githubApi.readBytes(
        getStoredFilePath({ id: concurrentFileId, fileType: 'mp4' }),
      ),
    ).not.toBeNull();
  });

  it('keeps deleted file bytes when the batched manifest flush fails', async () => {
    const repository = createRepository();
    const githubApi = getRepositoryTestGitHubApi();

    const fileId = await repository.createFile(
      'Doomed.mp4',
      'mp4',
      null,
      new Uint8Array([1, 2, 3]),
    );
    const storedPath = getStoredFilePath({ id: fileId, fileType: 'mp4' });

    // Not a conflict, so the flush throws instead of retrying and the manifest
    // still lists the file. Its bytes must survive with it.
    githubApi.failNextPut(MANIFEST_PATH, 500);
    await expect(
      repository.batchManifestWrites(() => repository.deleteNode(fileId)),
    ).rejects.toThrow();

    const manifest = readManifest(githubApi);

    expect(manifest?.nodes[fileId]).toBeDefined();
    expect(githubApi.readBytes(storedPath)).not.toBeNull();
  });

  it('reads batched manifest mutations back inside the batch', async () => {
    const repository = createRepository();

    const [folderId, chain] = await repository.batchManifestWrites(async () => {
      const id = await repository.createFolder('Batched', null);
      return [id, await repository.getFolderChain(id)] as const;
    });

    expect(chain.map((folder) => folder.id)).toEqual([folderId]);
  });

  it('exports a snapshot via a single tarball fetch', async () => {
    const repository = createRepository();
    const githubApi = getRepositoryTestGitHubApi();

    const fileA = await repository.createFile('A.mp4', 'mp4', null);
    const fileB = await repository.createFile('B.mp4', 'mp4', null);
    const bytesA = new Uint8Array([1, 2, 3, 4, 5]);
    const bytesB = new Uint8Array([9, 8, 7]);

    githubApi.setTarball(
      createGzippedTar('myelin-notes-abc1234', [
        {
          path: getStoredFilePath({ id: fileA, fileType: 'mp4' }),
          bytes: bytesA,
        },
        {
          path: getStoredFilePath({ id: fileB, fileType: 'mp4' }),
          bytes: bytesB,
        },
      ]),
    );

    const snapshot = await repository.exportSnapshot();

    expect(Array.from(snapshot.notes[fileA] ?? [])).toEqual(Array.from(bytesA));
    expect(Array.from(snapshot.notes[fileB] ?? [])).toEqual(Array.from(bytesB));
  });

  it('skips the tarball fetch when the manifest has no files', async () => {
    const repository = createRepository();
    const githubApi = getRepositoryTestGitHubApi();

    const snapshot = await repository.exportSnapshot();

    expect(snapshot.notes).toEqual({});
    expect(githubApi.tarballFetchCount).toBe(0);
  });

  it('retries the tarball fetch after a rate-limit response', async () => {
    const repository = createRepository();
    const githubApi = getRepositoryTestGitHubApi();

    const fileA = await repository.createFile('A.mp4', 'mp4', null);
    const bytesA = new Uint8Array([1, 2, 3]);

    githubApi.setTarball(
      createGzippedTar('myelin-notes-abc1234', [
        {
          path: getStoredFilePath({ id: fileA, fileType: 'mp4' }),
          bytes: bytesA,
        },
      ]),
    );
    githubApi.failNextTarball(429, 0);

    const snapshot = await repository.exportSnapshot();

    expect(githubApi.tarballFetchCount).toBe(2);
    expect(Array.from(snapshot.notes[fileA] ?? [])).toEqual(Array.from(bytesA));
  });

  it('returns null for files missing from the tarball', async () => {
    const repository = createRepository();
    const githubApi = getRepositoryTestGitHubApi();

    const fileA = await repository.createFile('A.mp4', 'mp4', null);
    const fileB = await repository.createFile('B.mp4', 'mp4', null);
    const bytesA = new Uint8Array([1, 2, 3]);

    githubApi.setTarball(
      createGzippedTar('myelin-notes-abc1234', [
        {
          path: getStoredFilePath({ id: fileA, fileType: 'mp4' }),
          bytes: bytesA,
        },
      ]),
    );

    const snapshot = await repository.exportSnapshot();

    expect(Array.from(snapshot.notes[fileA] ?? [])).toEqual(Array.from(bytesA));
    expect(snapshot.notes[fileB]).toBeNull();
  });
});
