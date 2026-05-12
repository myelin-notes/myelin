import { beforeEach, describe, expect, it } from 'vitest';
import {
  createGzippedTar,
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
      recordId: 'record-1',
      noteId: 'note-1',
      peerId: 'peer-1',
      ticket: 'iroh-ticket-1',
      updatedAt: now,
      expiresAt: now + 30_000,
    };

    expect(mailbox).not.toBeNull();
    await mailbox?.publish(record);

    expect(await mailbox?.list('note-1')).toEqual([record]);

    await mailbox?.remove('note-1', 'record-1');

    expect(await mailbox?.list('note-1')).toEqual([]);
  });

  it('retries live discovery publish after a GitHub content conflict', async () => {
    const repository = createRepository();
    const mailbox = repository.liveDiscoveryMailbox;
    const githubApi = getRepositoryTestGitHubApi();
    const now = Date.now();
    const record: LivePeerDiscoveryRecord = {
      version: LIVE_PEER_DISCOVERY_RECORD_VERSION,
      recordId: 'record-1',
      noteId: 'note-1',
      peerId: 'peer-1',
      ticket: 'iroh-ticket-1',
      updatedAt: now,
      expiresAt: now + 30_000,
    };

    githubApi.failNextPut('.myelin/live/v1/notes/note-1/record-1.json');
    await mailbox?.publish(record);

    expect(await mailbox?.list('note-1')).toEqual([record]);
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
      recordId: 'expired-record',
      noteId: 'note-1',
      peerId: 'expired-peer',
      ticket: 'expired-ticket',
      updatedAt: now - 60_000,
      expiresAt: now - 1,
    });

    expect(await mailbox?.list('note-1')).toEqual([]);
    expect(
      githubApi.readBytes('.myelin/live/v1/notes/note-1/expired-record.json'),
    ).not.toBeNull();
    await mailbox?.cleanupExpired('note-1');
    expect(
      githubApi.readBytes('.myelin/live/v1/notes/note-1/expired-record.json'),
    ).toBeNull();
    expect(
      githubApi.readBytes('.myelin/live/v1/notes/note-1/bad.json'),
    ).not.toBeNull();
  });

  it('does not clean up excluded live discovery records', async () => {
    const repository = createRepository();
    const mailbox = repository.liveDiscoveryMailbox;
    const now = Date.now();

    await mailbox?.publish({
      version: LIVE_PEER_DISCOVERY_RECORD_VERSION,
      recordId: 'current-record',
      noteId: 'note-1',
      peerId: 'peer-1',
      ticket: 'iroh-ticket-1',
      updatedAt: now - 60_000,
      expiresAt: now - 1,
    });

    await mailbox?.cleanupExpired('note-1', {
      excludeRecordIds: ['current-record'],
    });

    expect(await mailbox?.list('note-1')).toEqual([]);
    expect(
      getRepositoryTestGitHubApi().readBytes(
        '.myelin/live/v1/notes/note-1/current-record.json',
      ),
    ).not.toBeNull();
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
