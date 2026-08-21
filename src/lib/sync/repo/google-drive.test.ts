import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createNoteState,
  getRepositoryTestGoogleDriveApi,
  readNoteText,
  resetRepositoryTestDoubles,
} from '@/test/repository-test-utils';
import { GoogleDriveRepository } from './google-drive';
import type { VFSManifest } from './shared';

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
