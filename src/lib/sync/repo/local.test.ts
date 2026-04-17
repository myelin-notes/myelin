import { beforeEach, describe, expect, it } from 'vitest';
import {
  createNoteState,
  getRepositoryTestStorage,
  readNoteText,
  resetRepositoryTestDoubles,
} from '@/test/repository-test-utils';
import { LocalRepository } from './local';
import {
  createEmptyManifest,
  createFileNode,
  getNoteFileName,
  MANIFEST_PATH,
} from './shared';

describe('LocalRepository', () => {
  beforeEach(() => {
    resetRepositoryTestDoubles();
  });

  it('persists manifest and note data across instances', async () => {
    const repository = new LocalRepository('repositories/local-test');
    await repository.initialize();

    const folderId = await repository.createFolder('Docs', null);
    const fileId = await repository.createFile('Note', 'mcanvas', folderId);
    const note = createNoteState('hello local repository');

    const result = await repository.pushUpdates(fileId, note.update, {
      baseRevision: null,
      localStateVector: note.stateVector,
    });

    expect(result.accepted).toBe(true);

    const reopened = new LocalRepository('repositories/local-test');
    await reopened.initialize();

    const [folders, files] = await reopened.listDirectory(folderId);
    expect(folders).toHaveLength(0);
    expect(files).toHaveLength(1);
    expect(files[0]?.id).toBe(fileId);

    const snapshot = await reopened.loadDocument(fileId);
    expect(readNoteText(snapshot.update)).toBe('hello local repository');
  });

  it('returns reveal paths inside app data storage', async () => {
    const repository = new LocalRepository('repositories/reveal-test');
    await repository.initialize();

    const fileId = await repository.createFile('Reveal', 'mcanvas', null);
    const revealPath = await repository.getRevealPath(fileId);

    expect(revealPath).toBe(
      `/app-data/repositories/reveal-test/files/${getNoteFileName(fileId)}`,
    );
  });

  it('writes note files into storage-backed paths', async () => {
    const repository = new LocalRepository('repositories/file-test');
    await repository.initialize();

    const fileId = await repository.createFile('Saved', 'mcanvas', null);
    const note = createNoteState('persisted bytes');

    await repository.pushUpdates(fileId, note.update, {
      baseRevision: null,
      localStateVector: note.stateVector,
    });

    const storage = getRepositoryTestStorage();
    const storedBytes = storage.readBinary(
      `repositories/file-test/files/${getNoteFileName(fileId)}`,
    );

    expect(storedBytes).not.toBeNull();
    expect(readNoteText(storedBytes)).toBe('persisted bytes');
  });

  it('removes stored note bytes when a file is deleted', async () => {
    const repository = new LocalRepository('repositories/delete-test');
    await repository.initialize();

    const fileId = await repository.createFile('Trash', 'mcanvas', null);
    const note = createNoteState('delete me');

    await repository.pushUpdates(fileId, note.update, {
      baseRevision: null,
      localStateVector: note.stateVector,
    });

    const storage = getRepositoryTestStorage();
    const filePath = `repositories/delete-test/files/${getNoteFileName(fileId)}`;
    expect(storage.readBinary(filePath)).not.toBeNull();

    await repository.deleteNode(fileId);

    expect(storage.readBinary(filePath)).toBeNull();
    expect(await repository.getNode(fileId)).toBeNull();
  });

  it('recreates empty note files from snapshots without loading stale bytes', async () => {
    const repository = new LocalRepository('repositories/replace-test');
    const fileId = 'file-empty';
    const manifest = createEmptyManifest();
    manifest.children.push(fileId);
    manifest.nodes[fileId] = createFileNode(
      fileId,
      'Empty',
      'mcanvas',
      null,
      Date.now(),
    );

    await repository.replaceSnapshot({
      manifest,
      notes: {
        [fileId]: null,
      },
    });

    const storage = getRepositoryTestStorage();
    const storedBytes = storage.readBinary(
      `repositories/replace-test/files/${getNoteFileName(fileId)}`,
    );

    expect(storedBytes).not.toBeNull();
    expect(storedBytes).toHaveLength(0);

    const snapshot = await repository.loadDocument(fileId);
    expect(snapshot.update).toBeNull();
    expect(snapshot.revision).toBeNull();
  });

  it('reloads the manifest from disk after refresh', async () => {
    const repository = new LocalRepository('repositories/refresh-test');
    await repository.initialize();

    const folderId = await repository.createFolder('Docs', null);
    const storage = getRepositoryTestStorage();
    const manifestPath = `repositories/refresh-test/${MANIFEST_PATH}`;
    const manifest = JSON.parse(storage.readText(manifestPath) ?? '{}') as {
      nodes: Record<string, { name: string }>;
    };

    manifest.nodes[folderId].name = 'Renamed Outside Repository';
    await storage.writeTextFile(manifestPath, JSON.stringify(manifest));

    expect((await repository.getNode(folderId))?.name).toBe('Docs');

    await repository.refresh();

    expect((await repository.getNode(folderId))?.name).toBe(
      'Renamed Outside Repository',
    );
  });
});
