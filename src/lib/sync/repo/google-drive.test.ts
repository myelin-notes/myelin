import { beforeEach, describe, expect, it } from 'vitest';
import {
  createNoteState,
  getRepositoryTestGoogleDriveApi,
  readNoteText,
  resetRepositoryTestDoubles,
} from '@/test/repository-test-utils';
import {
  LIVE_PEER_DISCOVERY_RECORD_VERSION,
  type LivePeerDiscoveryRecord,
} from '../live/discovery';
import { GoogleDriveRepository } from './google-drive';
import { createEmptyManifest } from './shared';

function createRepository() {
  return new GoogleDriveRepository({
    credentialId: 'test-drive-credential',
  });
}

describe('GoogleDriveRepository', () => {
  beforeEach(() => {
    resetRepositoryTestDoubles();
  });

  it('initializes a missing manifest as an empty repository', async () => {
    const repository = createRepository();
    const driveApi = getRepositoryTestGoogleDriveApi();

    const stats = await repository.getStats();

    expect(stats).toEqual({
      totalFiles: 0,
      totalFolders: 0,
      totalTags: 0,
    });

    const manifestFile = driveApi.readFileByAppProperty(
      'myelin_role',
      'manifest',
    );
    expect(manifestFile).not.toBeNull();
    const manifestBytes = manifestFile
      ? driveApi.readBytes(manifestFile.id)
      : null;
    expect(
      JSON.parse(new TextDecoder().decode(manifestBytes ?? new Uint8Array())),
    ).toEqual(createEmptyManifest());
  });

  it('creates a Drive folder, manifest, and note content through the transport', async () => {
    const repository = createRepository();
    const driveApi = getRepositoryTestGoogleDriveApi();

    const folderId = await repository.createFolder('Docs', null);
    const fileId = await repository.createFile(
      'Remote note',
      'mcanvas',
      folderId,
    );
    const note = createNoteState('hello google drive repository');

    await repository.pushUpdates(fileId, note.update, {
      baseRevision: null,
      localStateVector: note.stateVector,
    });

    const rootFolder = driveApi.readFileByAppProperty('myelin_repository', '1');
    const manifestFile = driveApi.readFileByAppProperty(
      'myelin_role',
      'manifest',
    );
    const noteFile = driveApi.readFileByAppProperty('myelin_note_id', fileId);

    expect(rootFolder?.name).toBe('Myelin');
    expect(manifestFile).not.toBeNull();
    expect(noteFile?.name).toBe(`${fileId}.myelin`);

    const manifestBytes = manifestFile
      ? driveApi.readBytes(manifestFile.id)
      : null;
    expect(manifestBytes).not.toBeNull();
    const manifest = JSON.parse(
      new TextDecoder().decode(manifestBytes ?? new Uint8Array()),
    ) as {
      nodes: Record<string, { name: string; parentId: string | null }>;
    };

    expect(manifest.nodes[folderId]?.name).toBe('Docs');
    expect(manifest.nodes[fileId]?.parentId).toBe(folderId);
    expect(
      readNoteText(noteFile ? driveApi.readBytes(noteFile.id) : null),
    ).toBe('hello google drive repository');
  });

  it('stores image file bytes with image metadata through the transport', async () => {
    const repository = createRepository();
    const driveApi = getRepositoryTestGoogleDriveApi();
    const bytes = new Uint8Array([137, 80, 78, 71]);

    const fileId = await repository.createFile('Photo.png', 'png', null, bytes);

    const file = driveApi.readFileByAppProperty('myelin_note_id', fileId);

    expect(file?.name).toBe(`${fileId}.png`);
    expect(file?.mimeType).toBe('image/png');
    expect(Array.from(file ? (driveApi.readBytes(file.id) ?? []) : [])).toEqual(
      Array.from(bytes),
    );
    expect(Array.from((await repository.readFileBytes(fileId)) ?? [])).toEqual(
      Array.from(bytes),
    );
  });

  it('publishes and removes live discovery records', async () => {
    const repository = createRepository();
    const mailbox = repository.liveDiscoveryMailbox;
    const driveApi = getRepositoryTestGoogleDriveApi();
    const now = Date.now();
    const record: LivePeerDiscoveryRecord = {
      version: LIVE_PEER_DISCOVERY_RECORD_VERSION,
      recordId: 'record-1',
      noteId: 'note-1',
      peerId: 'peer-1',
      nodeId: 'iroh-node-1',
      updatedAt: now,
      expiresAt: now + 30_000,
    };

    expect(mailbox).not.toBeNull();
    await mailbox?.publish(record);

    expect(await mailbox?.list('note-1')).toEqual([record]);
    expect(
      driveApi.readFileByAppProperty('myelin_peer_id', 'peer-1')?.appProperties,
    ).toMatchObject({
      myelin_role: 'live_discovery',
      myelin_note_id: 'note-1',
      myelin_peer_id: 'peer-1',
      myelin_live_record_id: 'record-1',
    });

    await mailbox?.remove('note-1', 'record-1');

    expect(await mailbox?.list('note-1')).toEqual([]);
  });

  it('ignores missing and expired live discovery records', async () => {
    const repository = createRepository();
    const mailbox = repository.liveDiscoveryMailbox;
    const driveApi = getRepositoryTestGoogleDriveApi();
    const now = Date.now();

    expect(await mailbox?.list('note-1')).toEqual([]);

    await mailbox?.publish({
      version: LIVE_PEER_DISCOVERY_RECORD_VERSION,
      recordId: 'expired-record',
      noteId: 'note-1',
      peerId: 'expired-peer',
      nodeId: 'expired-node',
      updatedAt: now - 60_000,
      expiresAt: now - 1,
    });

    expect(await mailbox?.list('note-1')).toEqual([]);
    expect(
      driveApi.readFileByAppProperty('myelin_live_record_id', 'expired-record'),
    ).not.toBeNull();
    await mailbox?.cleanupExpired('note-1');
    expect(
      driveApi.readFileByAppProperty('myelin_live_record_id', 'expired-record'),
    ).toBeNull();
  });

  it('does not clean up excluded live discovery records', async () => {
    const repository = createRepository();
    const mailbox = repository.liveDiscoveryMailbox;
    const driveApi = getRepositoryTestGoogleDriveApi();
    const now = Date.now();

    await mailbox?.publish({
      version: LIVE_PEER_DISCOVERY_RECORD_VERSION,
      recordId: 'current-record',
      noteId: 'note-1',
      peerId: 'peer-1',
      nodeId: 'iroh-node-1',
      updatedAt: now - 60_000,
      expiresAt: now - 1,
    });

    await mailbox?.cleanupExpired('note-1', {
      excludeRecordIds: ['current-record'],
    });

    expect(await mailbox?.list('note-1')).toEqual([]);
    expect(
      driveApi.readFileByAppProperty('myelin_live_record_id', 'current-record'),
    ).not.toBeNull();
  });
});
