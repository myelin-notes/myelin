import { beforeEach, describe, expect, it } from 'vitest';
import {
  createNoteState,
  getRepositoryTestGitHubApi,
  readNoteText,
  resetRepositoryTestDoubles,
} from '@/test/repository-test-utils';
import {
  LIVE_PEER_DISCOVERY_RECORD_VERSION,
  type LivePeerDiscoveryRecord,
} from '../live/discovery';
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

  it('publishes and removes live discovery records', async () => {
    const repository = createRepository();
    const mailbox = repository.liveDiscoveryMailbox;
    const now = Date.now();
    const record: LivePeerDiscoveryRecord = {
      version: LIVE_PEER_DISCOVERY_RECORD_VERSION,
      noteId: 'note-1',
      peerId: 'peer-1',
      ticket: 'iroh-ticket-1',
      updatedAt: now,
      expiresAt: now + 30_000,
    };

    expect(mailbox).not.toBeNull();
    await mailbox?.publish(record);

    expect(await mailbox?.list('note-1')).toEqual([record]);

    await mailbox?.remove('note-1', 'peer-1');

    expect(await mailbox?.list('note-1')).toEqual([]);
  });

  it('ignores missing, malformed, and expired live discovery records', async () => {
    const repository = createRepository();
    const mailbox = repository.liveDiscoveryMailbox;
    const githubApi = getRepositoryTestGitHubApi();
    const now = Date.now();

    expect(await mailbox?.list('note-1')).toEqual([]);

    githubApi.writeBytes(
      '.myelin/live/v1/notes/note-1/bad.json',
      new TextEncoder().encode('{bad json'),
    );
    await mailbox?.publish({
      version: LIVE_PEER_DISCOVERY_RECORD_VERSION,
      noteId: 'note-1',
      peerId: 'expired-peer',
      ticket: 'expired-ticket',
      updatedAt: now - 60_000,
      expiresAt: now - 1,
    });

    expect(await mailbox?.list('note-1')).toEqual([]);
  });
});
