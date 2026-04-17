import { beforeEach, describe, expect, it } from 'vitest';
import {
  createNoteState,
  getRepositoryTestGitHubApi,
  readNoteText,
  resetRepositoryTestDoubles,
} from '@/test/repository-test-utils';
import { GitHubRepository } from './github';
import { getNotePath, MANIFEST_PATH } from './shared';

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
