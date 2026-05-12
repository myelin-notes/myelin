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
    expect(githubApi.readJson(MANIFEST_PATH)).toEqual(createEmptyManifest());
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

    const manifest = githubApi.readJson<{
      nodes: Record<string, { name: string; parentId: string | null }>;
    }>(MANIFEST_PATH);

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

    const manifest = githubApi.readJson<{
      nodes: Record<string, { name: string; fileType: string; type: string }>;
    }>(MANIFEST_PATH);
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
    const manifest = githubApi.readJson<{
      nodes: Record<string, { name: string }>;
    }>(MANIFEST_PATH);

    expect(manifest).not.toBeNull();
    expect(manifest?.nodes[folderId]?.name).toBe('Retry folder');
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
