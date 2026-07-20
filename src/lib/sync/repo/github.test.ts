import { beforeEach, describe, expect, it } from 'vitest';
import {
  createGzippedTar,
  createNoteState,
  getRepositoryTestGitHubApi,
  readNoteText,
  resetRepositoryTestDoubles,
} from '@/test/repository-test-utils';
import { GitHubRepository } from './github';
import {
  decodeManifestDocument,
  readManifestFromDocument,
} from './manifest-yjs';
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

class ConflictInjectingGitHubRepository extends GitHubRepository {
  private didInjectConflict = false;

  constructor(private readonly injectConflict: () => Promise<void>) {
    super({
      owner: 'myelin',
      repo: 'notes',
      branch: 'main',
      credentialId: 'test-credential',
    });
  }

  protected override async saveManifestImpl(
    update: Uint8Array,
    revision: string | null,
    action: string,
  ): Promise<string | null> {
    if (!this.didInjectConflict) {
      this.didInjectConflict = true;
      await this.injectConflict();
    }
    return super.saveManifestImpl(update, revision, action);
  }
}

function readManifest() {
  const bytes = getRepositoryTestGitHubApi().readBytes(MANIFEST_PATH);
  return readManifestFromDocument(decodeManifestDocument(bytes).doc);
}

describe('GitHubRepository', () => {
  beforeEach(() => {
    resetRepositoryTestDoubles();
  });

  it('initializes missing manifest content as an empty repository', async () => {
    const repository = createRepository();

    const stats = await repository.getStats();

    expect(stats).toEqual({
      totalFiles: 0,
      totalFolders: 0,
      totalTags: 0,
    });
    expect(readManifest()).toEqual(createEmptyManifest());
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

    const manifest = readManifest();

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

    const manifest = readManifest();
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
    const manifest = readManifest();

    expect(manifest).not.toBeNull();
    expect(manifest?.nodes[folderId]?.name).toBe('Retry folder');
  });

  it('merges a stale manifest write through Yjs', async () => {
    const initial = createRepository();
    const other = createRepository();
    const repository = new ConflictInjectingGitHubRepository(async () => {
      await other.createFolder('B', null);
    });

    await initial.initialize();
    await repository.initialize();
    const folderA = await repository.createFolder('A', null);

    const manifest = readManifest();
    expect(manifest.nodes[folderA]?.name).toBe('A');
    expect(Object.values(manifest.nodes).map((node) => node.name)).toContain(
      'B',
    );
  });

  it('keeps deleted file bytes when a manifest write fails', async () => {
    const repository = createRepository();
    const githubApi = getRepositoryTestGitHubApi();

    const fileId = await repository.createFile(
      'Doomed.mp4',
      'mp4',
      null,
      new Uint8Array([1, 2, 3]),
    );
    const storedPath = getStoredFilePath({ id: fileId, fileType: 'mp4' });

    // Not a conflict, so the save throws instead of retrying and the manifest
    // still lists the file. Its bytes must survive with it.
    githubApi.failNextPut(MANIFEST_PATH, 500);
    await expect(repository.deleteNode(fileId)).rejects.toThrow();

    const manifest = readManifest();
    expect(manifest.nodes[fileId]).toBeDefined();
    expect(githubApi.readBytes(storedPath)).not.toBeNull();
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
