import { beforeEach, describe, expect, it } from 'vitest';
import {
  createNoteState,
  getRepositoryTestGitHubApi,
  readNoteText,
  resetRepositoryTestDoubles,
} from '@/test/repository-test-utils';
import { GitHubRepository } from './github';
import { getNotePath, getStoredFilePath, MANIFEST_PATH } from './shared';

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

  it('treats missing manifest content as an empty repository', async () => {
    const repository = createRepository();

    const stats = await repository.getStats();

    expect(stats).toEqual({
      totalFiles: 0,
      totalFolders: 0,
      totalTags: 0,
    });
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

    githubApi.failNextPut(MANIFEST_PATH);

    const folderId = await repository.createFolder('Retry folder', null);
    const manifest = githubApi.readJson<{
      nodes: Record<string, { name: string }>;
    }>(MANIFEST_PATH);

    expect(manifest).not.toBeNull();
    expect(manifest?.nodes[folderId]?.name).toBe('Retry folder');
  });
});
