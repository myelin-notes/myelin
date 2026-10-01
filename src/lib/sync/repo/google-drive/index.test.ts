import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { trackEvent } from '@/lib/analytics';
import {
  createNoteState,
  getRepositoryTestGoogleDriveApi,
  getRepositoryTestStorage,
  readNoteText,
  resetRepositoryTestDoubles,
} from '@/test/repository-test-utils';
import { CachedRepository } from '../cached';
import { LocalRepository } from '../local';
import { createEmptyManifest, type VFSManifest } from '../shared';
import { GoogleDriveRepository } from '.';

vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }));

function createRepository(): GoogleDriveRepository {
  return new GoogleDriveRepository({
    folderId: getRepositoryTestGoogleDriveApi().rootFolderId,
    credentialId: 'test-credential',
  });
}

/** Simulates another device writing the manifest between our read and write. */
function injectExternalNode(nodeId: string): void {
  const drive = getRepositoryTestGoogleDriveApi();
  const manifest = drive.readJson<VFSManifest>('manifest.json');
  if (!manifest) {
    throw new Error('Expected a manifest to already exist.');
  }
  manifest.nodes[nodeId] = {
    id: nodeId,
    name: 'External',
    type: 'folder',
    parentId: null,
    tags: [],
    createdAt: 1,
    modifiedAt: 1,
  };
  drive.writeBytes(
    'manifest.json',
    new TextEncoder().encode(JSON.stringify(manifest)),
  );
}

describe('GoogleDriveRepository', () => {
  beforeEach(() => {
    resetRepositoryTestDoubles();
    vi.mocked(trackEvent).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('honours a long Retry-After once, then gives up', async () => {
    vi.useFakeTimers();
    const drive = getRepositoryTestGoogleDriveApi();
    // Four attempts each honouring `Retry-After: 60` would park the caller for
    // three minutes; the budget spends that wait once and fails instead.
    drive.rateLimitEveryRequest(429, 60);

    const pending = createRepository().initialize();
    const settled = expect(pending).rejects.toThrow(/429/);
    await vi.advanceTimersByTimeAsync(60_000);
    await settled;

    expect(drive.requestCount).toBe(2);
  });

  it('tracks safe Drive response diagnostics on sync failure', async () => {
    const remote = createRepository();
    const repository = new CachedRepository(
      remote,
      new LocalRepository('repositories/drive-diagnostics'),
      'repositories/drive-diagnostics/outbox.json',
    );
    await repository.initialize();
    await repository.createFile('Private note title', 'mcanvas', null);
    getRepositoryTestGoogleDriveApi().rateLimitEveryRequest(429, 0);

    await expect(repository.flushPending()).rejects.toThrow(/429/);

    const failure = vi
      .mocked(trackEvent)
      .mock.calls.filter(([event]) => event === 'sync_failed')
      .at(-1)?.[1];
    expect(failure).toMatchObject({
      repository_kind: 'google-drive',
      pending_remote_writes: 2,
      google_drive_stage: 'api_request',
      google_drive_method: 'GET',
      google_drive_attempts: 4,
      google_drive_status: 429,
      google_drive_retry_after: '0',
    });
    expect(failure?.google_drive_operation).toMatch(/^Google Drive /);
    expect(failure?.google_drive_duration_ms).toBeGreaterThanOrEqual(0);
    expect(failure?.google_drive_response_chars).toBeGreaterThan(0);
    expect(JSON.stringify(failure)).not.toContain('Private note title');
  });

  it('stops waiting out a rate limit once disposed', async () => {
    vi.useFakeTimers();
    const drive = getRepositoryTestGoogleDriveApi();
    drive.rateLimitEveryRequest(429, 60);

    const repository = createRepository();
    const pending = repository.initialize();
    const settled = expect(pending).rejects.toThrow(/cancelled/);
    await vi.advanceTimersByTimeAsync(1_000);
    await repository.dispose();
    await settled;
  });

  it('stores the manifest and files in the GitHub-compatible layout', async () => {
    const drive = getRepositoryTestGoogleDriveApi();
    const repository = createRepository();
    await repository.initialize();

    const noteId = await repository.createFile('Note', 'mcanvas', null);
    const note = createNoteState('drive hello');
    await repository.pushUpdates(noteId, note.update, {
      baseRevision: null,
      localStateVector: note.stateVector,
    });
    const imageId = await repository.createFile(
      'Photo.png',
      'png',
      null,
      new Uint8Array([9, 8, 7]),
    );

    expect(drive.readJson<VFSManifest>('manifest.json')?.nodes).toHaveProperty(
      noteId,
    );
    expect(readNoteText(drive.readBytes(`files/${noteId}.myelin`))).toBe(
      'drive hello',
    );
    expect(Array.from(drive.readBytes(`files/${imageId}.png`) ?? [])).toEqual([
      9, 8, 7,
    ]);

    await repository.deleteNode(imageId);
    expect(drive.readBytes(`files/${imageId}.png`)).toBeNull();
  });

  it('exports a snapshot without re-reading the manifest per file', async () => {
    const repository = createRepository();
    await repository.initialize();

    const noteId = await repository.createFile('Note', 'mcanvas', null);
    const note = createNoteState('snapshot me');
    await repository.pushUpdates(noteId, note.update, {
      baseRevision: null,
      localStateVector: note.stateVector,
    });

    const snapshot = await repository.exportSnapshot();
    expect(Object.keys(snapshot.manifest.nodes)).toContain(noteId);
    expect(readNoteText(snapshot.notes[noteId] ?? null)).toBe('snapshot me');
  });

  it('recovers notes and marked history locally, then syncs only the manifest', async () => {
    const drive = getRepositoryTestGoogleDriveApi();
    const remote = createRepository();
    await remote.initialize();
    const note = createNoteState('surviving content');
    const noteId = await remote.createFile(
      'Lost name',
      'mcanvas',
      null,
      note.update,
    );
    const version = await remote.createFileVersionIfDue(noteId, {
      force: true,
    });
    expect(version).not.toBeNull();
    drive.writeBytes(
      'manifest.json',
      new TextEncoder().encode(JSON.stringify(createEmptyManifest())),
    );

    const root = 'repositories/drive-recovery';
    const cache = new LocalRepository(root);
    const repository = new CachedRepository(
      remote,
      cache,
      `${root}/outbox.json`,
    );
    await repository.initialize();
    expect((await repository.listDirectory(null))[1]).toHaveLength(0);
    const uploadsBefore = drive.uploadCallCount;
    const dataVersion = repository.getRuntimeStatus().dataVersion;

    expect(await repository.recoverManifest()).toEqual({
      notesRecovered: 1,
      versionsRecovered: 1,
    });
    expect(
      (await repository.listDirectory(null))[1].map((node) => node.id),
    ).toEqual([noteId]);
    expect((await repository.listFileVersions(noteId))[0]).toMatchObject({
      id: version!.id,
      sourceFileId: noteId,
      sourceRevision: version!.sourceRevision,
    });
    expect(readNoteText(await repository.readFileBytes(noteId))).toBe(
      'surviving content',
    );
    expect(readNoteText(await repository.readFileBytes(version!.id))).toBe(
      'surviving content',
    );
    expect(repository.getRuntimeStatus()).toMatchObject({
      pendingRemoteWrites: 3,
      dataVersion: dataVersion + 1,
    });
    expect(drive.readJson<VFSManifest>('manifest.json')?.nodes).toEqual({});
    expect(drive.uploadCallCount).toBe(uploadsBefore);
    expect(
      JSON.parse(
        getRepositoryTestStorage().readText(`${root}/outbox.json`) ?? '[]',
      ),
    ).toHaveLength(3);

    const reopened = new CachedRepository(
      createRepository(),
      new LocalRepository(root),
      `${root}/outbox.json`,
    );
    await reopened.initialize();
    expect((await reopened.listDirectory(null))[1]).toHaveLength(1);
    await reopened.flushPending();
    expect(
      drive.readJson<VFSManifest>('manifest.json')?.nodes[version!.id]?.system,
    ).toMatchObject({ kind: 'file-version', sourceFileId: noteId });
    expect(drive.uploadCallCount - uploadsBefore).toBe(3);
    expect(readNoteText(drive.readBytes(`files/${noteId}.myelin`))).toBe(
      'surviving content',
    );
    expect(await reopened.recoverManifest()).toEqual({
      notesRecovered: 0,
      versionsRecovered: 0,
    });
    expect(reopened.getRuntimeStatus().pendingRemoteWrites).toBe(0);
  });

  it('infers legacy snapshots by Yjs lineage and keeps independent and ambiguous files visible', async () => {
    const drive = getRepositoryTestGoogleDriveApi();
    const doc = new Y.Doc();
    doc.getText('content').insert(0, 'old');
    const old = Y.encodeStateAsUpdate(doc);
    doc.getText('content').insert(3, ' current');
    const current = Y.encodeStateAsUpdate(doc);
    doc.destroy();
    drive.writeBytes('files/current.myelin', current, {
      createdTime: '2026-09-01T00:00:00Z',
    });
    drive.writeBytes('files/history.myelin', old, {
      createdTime: '2026-09-02T00:00:00Z',
    });
    drive.writeBytes('files/history-2.myelin', old, {
      createdTime: '2026-09-03T00:00:00Z',
    });
    drive.writeBytes(
      'files/independent.myelin',
      createNoteState('old').update,
      { createdTime: '2026-09-04T00:00:00Z' },
    );
    drive.writeBytes('files/copy.myelin', current, {
      createdTime: '2026-09-05T00:00:00Z',
      appProperties: { myelinKind: 'note' },
    });
    drive.writeBytes('files/no-date.myelin', old, { createdTime: 'invalid' });
    drive.writeBytes('files/orphan-history.myelin', old, {
      appProperties: {
        myelinKind: 'file-version',
        myelinSourceFileId: 'missing',
      },
    });
    drive.writeBytes('files/image.png', new Uint8Array([1, 2, 3]));
    const repository = new CachedRepository(
      createRepository(),
      new LocalRepository('repositories/legacy-recovery'),
      'repositories/legacy-recovery/outbox.json',
    );
    await repository.initialize();

    expect(await repository.recoverManifest()).toEqual({
      notesRecovered: 5,
      versionsRecovered: 2,
    });
    expect(
      (await repository.listDirectory(null))[1].map((node) => node.id).sort(),
    ).toEqual(['copy', 'current', 'independent', 'no-date', 'orphan-history']);
    expect(
      (await repository.listFileVersions('current')).map((node) => node.id),
    ).toEqual(['history-2', 'history']);
    expect(await repository.getNode('image')).toBeNull();
    expect(readNoteText(await repository.readFileBytes('history'))).toBe('old');
  });

  it('preserves existing metadata and pending edits and deletes during recovery', async () => {
    const remote = createRepository();
    await remote.initialize();
    const folderId = await remote.createFolder('Folder', null);
    const noteId = await remote.createFile(
      'Existing',
      'mcanvas',
      folderId,
      createNoteState('existing').update,
    );
    const deletedId = await remote.createFile(
      'Deleted',
      'mcanvas',
      null,
      createNoteState('delete me').update,
    );
    const repository = new CachedRepository(
      remote,
      new LocalRepository('repositories/recovery-pending'),
      'repositories/recovery-pending/outbox.json',
    );
    await repository.initialize();
    await repository.renameNode(noteId, 'Renamed locally');
    await repository.setTags(noteId, ['keep']);
    await repository.writeFileBytes(
      noteId,
      createNoteState('local edit').update,
    );
    await repository.deleteNode(deletedId);
    getRepositoryTestGoogleDriveApi().writeBytes(
      'files/recovered.myelin',
      createNoteState('recovered').update,
    );

    expect(await repository.recoverManifest()).toEqual({
      notesRecovered: 1,
      versionsRecovered: 0,
    });
    expect(await repository.getNode(noteId)).toMatchObject({
      name: 'Renamed locally',
      parentId: folderId,
      tags: ['keep'],
    });
    expect(readNoteText(await repository.readFileBytes(noteId))).toBe(
      'local edit',
    );
    expect(await repository.getNode(deletedId)).toBeNull();
    await repository.flushPending();
    expect(
      getRepositoryTestGoogleDriveApi().readJson<VFSManifest>('manifest.json')
        ?.nodes[noteId],
    ).toMatchObject({ name: 'Renamed locally', tags: ['keep'] });
    expect(
      getRepositoryTestGoogleDriveApi().readBytes(`files/${deletedId}.myelin`),
    ).toBeNull();
  });

  it('leaves manifests untouched if a stored note cannot be decoded', async () => {
    const drive = getRepositoryTestGoogleDriveApi();
    drive.writeBytes('files/valid.myelin', createNoteState('valid').update);
    drive.writeBytes('files/invalid.myelin', new Uint8Array([255]));
    const cache = new LocalRepository('repositories/recovery-invalid');
    const repository = new CachedRepository(
      createRepository(),
      cache,
      'repositories/recovery-invalid/outbox.json',
    );
    await repository.initialize();
    const uploadsBefore = drive.uploadCallCount;

    await expect(repository.recoverManifest()).rejects.toThrow(
      'Invalid note file: invalid.myelin',
    );
    expect((await cache.exportManifest()).nodes).toEqual({});
    expect(repository.getRuntimeStatus().pendingRemoteWrites).toBe(0);
    expect(drive.uploadCallCount).toBe(uploadsBefore);
  });

  it('uploads recovered entries on the normal background sync timer', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('window', { setInterval, clearInterval });
    const drive = getRepositoryTestGoogleDriveApi();
    drive.writeBytes(
      'files/recovered.myelin',
      createNoteState('background').update,
    );
    const repository = new CachedRepository(
      createRepository(),
      new LocalRepository('repositories/recovery-background'),
      'repositories/recovery-background/outbox.json',
    );
    try {
      await repository.initialize();
      await repository.recoverManifest();
      expect(repository.getRuntimeStatus().pendingRemoteWrites).toBe(1);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(repository.getRuntimeStatus().pendingRemoteWrites).toBe(0);
      expect(
        drive.readJson<VFSManifest>('manifest.json')?.nodes.recovered,
      ).toMatchObject({ type: 'file', fileType: 'mcanvas' });
    } finally {
      await repository.dispose();
      vi.unstubAllGlobals();
    }
  });

  it('retries a manifest write that lost a race, keeping both changes', async () => {
    const drive = getRepositoryTestGoogleDriveApi();
    const repository = createRepository();
    await repository.initialize();
    await repository.createFile('Note', 'mcanvas', null);

    drive.beforeNextDownload(() => injectExternalNode('external-node'));
    const localFolderId = await repository.createFolder('Local', null);

    const stored = drive.readJson<VFSManifest>('manifest.json');
    expect(Object.keys(stored?.nodes ?? {})).toContain('external-node');
    expect(Object.keys(stored?.nodes ?? {})).toContain(localFolderId);
  });

  it('fails that same race when the conflict is not recognized', async () => {
    // Control for the test above: without conflict detection the write is not
    // retried, so the race surfaces as an error rather than being absorbed.
    class BlindGoogleDriveRepository extends GoogleDriveRepository {
      protected override isConflictError(): boolean {
        return false;
      }
    }

    const drive = getRepositoryTestGoogleDriveApi();
    const repository = new BlindGoogleDriveRepository({
      folderId: drive.rootFolderId,
      credentialId: 'test-credential',
    });
    await repository.initialize();
    await repository.createFile('Note', 'mcanvas', null);

    drive.beforeNextDownload(() => injectExternalNode('external-node'));
    await expect(repository.createFolder('Local', null)).rejects.toThrow(
      /changed before the write landed/,
    );
  });
});
