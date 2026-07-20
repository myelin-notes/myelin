import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { getPlatform } from '@/platform';
import {
  createCanvasNoteState,
  getRepositoryTestStorage,
  resetRepositoryTestDoubles,
} from '@/test/repository-test-utils';
import { LocalRepository } from './local';
import { ManifestDocument } from './manifest-document';
import { getStoredFileName, MANIFEST_PATH } from './shared';

function readManifest(storageRoot: string) {
  const bytes = getRepositoryTestStorage().readBinary(
    `${storageRoot}/${MANIFEST_PATH}`,
  );
  return ManifestDocument.fromBytes(bytes!).getManifest();
}

describe('repository file version history', () => {
  beforeEach(() => {
    resetRepositoryTestDoubles();
    vi.useRealTimers();
  });

  it('stores versions as hidden repository files', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    const repository = new LocalRepository('repositories/version-hidden-test');
    await repository.initialize();

    const fileId = await repository.createFile(
      'Photo.png',
      'png',
      null,
      new Uint8Array([1, 2, 3]),
    );

    const version = await repository.createFileVersionIfDue(fileId);

    expect(version).toMatchObject({
      sourceFileId: fileId,
      capturedAt: Date.parse('2026-01-01T00:00:00Z'),
      fileType: 'png',
      byteLength: 3,
    });
    expect(
      Array.from((await repository.readFileBytes(version?.id ?? '')) ?? []),
    ).toEqual([1, 2, 3]);

    const [rootFolders, rootFiles] = await repository.listDirectory(null);
    expect(rootFolders).toHaveLength(0);
    expect(rootFiles.map((file) => file.id)).toEqual([fileId]);
    expect(
      (await repository.searchNodes('Photo')).map((result) => result.node.id),
    ).toEqual([fileId]);
    expect(await repository.getStats()).toEqual({
      totalFiles: 1,
      totalFolders: 0,
      totalTags: 0,
    });
    expect((await repository.getRecentFiles()).map((file) => file.id)).toEqual([
      fileId,
    ]);

    const manifest = readManifest('repositories/version-hidden-test');
    expect(Object.keys(manifest.nodes)).toHaveLength(3);
  });

  it('does not reindex version-history snapshots of notes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    const noteIndex = getPlatform().noteIndex;
    if (!noteIndex) {
      throw new Error('fake platform is expected to provide noteIndex');
    }
    const reindexSpy = vi.spyOn(noteIndex, 'requestReindex');

    const repository = new LocalRepository('repositories/version-index-test');
    await repository.initialize();

    const noteId = await repository.createFile(
      'Note.mcanvas',
      'mcanvas',
      null,
      Y.encodeStateAsUpdate(new Y.Doc()),
    );

    const version = await repository.createFileVersionIfDue(noteId);
    expect(version).not.toBeNull();

    const reindexedIds = reindexSpy.mock.calls.map(([id]) => id);
    expect(reindexedIds).toContain(noteId);
    expect(reindexedIds).not.toContain(version?.id);

    reindexSpy.mockRestore();
  });

  it('creates versions only when the file changed and the interval has passed', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    const repository = new LocalRepository('repositories/version-cadence-test');
    await repository.initialize();

    const fileId = await repository.createFile(
      'Clip.mp4',
      'mp4',
      null,
      new Uint8Array([1]),
    );

    expect(await repository.createFileVersionIfDue(fileId)).not.toBeNull();

    vi.setSystemTime(new Date('2026-01-01T00:05:00Z'));
    await repository.writeFileBytes(fileId, new Uint8Array([2]));
    expect(await repository.createFileVersionIfDue(fileId)).toBeNull();

    vi.setSystemTime(new Date('2026-01-01T00:11:00Z'));
    const second = await repository.createFileVersionIfDue(fileId);
    expect(second?.capturedAt).toBe(Date.parse('2026-01-01T00:11:00Z'));

    vi.setSystemTime(new Date('2026-01-01T00:22:00Z'));
    expect(await repository.createFileVersionIfDue(fileId)).toBeNull();

    expect(
      (await repository.listFileVersions(fileId)).map(
        (version) => version.capturedAt,
      ),
    ).toEqual([
      Date.parse('2026-01-01T00:11:00Z'),
      Date.parse('2026-01-01T00:00:00Z'),
    ]);
  });

  it('keeps 32 versions and restores content without metadata changes', async () => {
    vi.useFakeTimers();

    const repository = new LocalRepository('repositories/version-restore-test');
    await repository.initialize();

    const folderId = await repository.createFolder('Docs', null);
    const fileId = await repository.createFile(
      'Photo.png',
      'png',
      folderId,
      new Uint8Array([0]),
    );
    await repository.setTags(fileId, ['keep']);

    for (let index = 0; index < 33; index += 1) {
      vi.setSystemTime(new Date(Date.UTC(2026, 0, 1, 0, index * 11)));
      await repository.writeFileBytes(fileId, new Uint8Array([index]));
      await repository.createFileVersionIfDue(fileId);
    }

    let versions = await repository.listFileVersions(fileId);
    expect(versions).toHaveLength(32);
    expect(
      Array.from((await repository.readFileBytes(versions[31].id)) ?? []),
    ).toEqual([1]);

    vi.setSystemTime(new Date('2026-01-02T00:00:00Z'));
    await repository.renameNode(fileId, 'Current name.png');
    await repository.writeFileBytes(fileId, new Uint8Array([99]));
    await repository.restoreFileVersion(fileId, versions[31].id);

    const restoredNode = await repository.getNode(fileId);
    expect(restoredNode).toMatchObject({
      id: fileId,
      name: 'Current name.png',
      parentId: folderId,
      tags: ['keep'],
    });
    expect(Array.from((await repository.readFileBytes(fileId)) ?? [])).toEqual([
      1,
    ]);

    versions = await repository.listFileVersions(fileId);
    expect(versions).toHaveLength(32);
    expect(
      Array.from((await repository.readFileBytes(versions[0].id)) ?? []),
    ).toEqual([99]);
  });

  it('does not duplicate existing history when restoring back and forth', async () => {
    vi.useFakeTimers();

    const repository = new LocalRepository('repositories/version-toggle-test');
    await repository.initialize();

    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const fileId = await repository.createFile(
      'Photo.png',
      'png',
      null,
      new Uint8Array([1]),
    );
    const firstVersion = await repository.createFileVersionIfDue(fileId);
    expect(firstVersion).not.toBeNull();

    vi.setSystemTime(new Date('2026-01-01T00:01:00Z'));
    await repository.writeFileBytes(fileId, new Uint8Array([2]));

    vi.setSystemTime(new Date('2026-01-01T00:02:00Z'));
    await repository.restoreFileVersion(fileId, firstVersion?.id ?? '');

    let versions = await repository.listFileVersions(fileId);
    expect(versions).toHaveLength(2);
    const secondVersion = versions[0];
    expect(
      Array.from(
        (await repository.readFileBytes(secondVersion?.id ?? '')) ?? [],
      ),
    ).toEqual([2]);

    vi.setSystemTime(new Date('2026-01-01T00:03:00Z'));
    await repository.restoreFileVersion(fileId, secondVersion?.id ?? '');

    versions = await repository.listFileVersions(fileId);
    expect(versions).toHaveLength(2);
    expect(Array.from((await repository.readFileBytes(fileId)) ?? [])).toEqual([
      2,
    ]);
  });

  it('does not mutate the file when restoring the current content', async () => {
    vi.useFakeTimers();

    const repository = new LocalRepository(
      'repositories/version-current-restore-test',
    );
    await repository.initialize();

    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const fileId = await repository.createFile(
      'Photo.png',
      'png',
      null,
      new Uint8Array([1]),
    );
    const version = await repository.createFileVersionIfDue(fileId);
    expect(version).not.toBeNull();

    const beforeRestore = await repository.getNode(fileId);
    const beforeModifiedAt =
      beforeRestore && beforeRestore.type === 'file'
        ? beforeRestore.modifiedAt
        : null;

    vi.setSystemTime(new Date('2026-01-01T00:10:00Z'));
    await repository.restoreFileVersion(fileId, version?.id ?? '');

    expect(await repository.getNode(fileId)).toMatchObject({
      modifiedAt: beforeModifiedAt,
    });
    expect(await repository.listFileVersions(fileId)).toHaveLength(1);
  });

  it('does not restore missing version data as an empty file', async () => {
    const repository = new LocalRepository('repositories/version-missing-test');
    await repository.initialize();

    const fileId = await repository.createFile(
      'Photo.png',
      'png',
      null,
      new Uint8Array([1]),
    );
    const version = await repository.createFileVersionIfDue(fileId);
    expect(version).not.toBeNull();

    await repository.writeFileBytes(fileId, new Uint8Array([2]));
    await getRepositoryTestStorage().remove(
      `repositories/version-missing-test/files/${getStoredFileName({
        id: version?.id ?? '',
        fileType: 'png',
      })}`,
    );

    await expect(
      repository.restoreFileVersion(fileId, version?.id ?? ''),
    ).rejects.toThrow('Version data is missing.');
    expect(Array.from((await repository.readFileBytes(fileId)) ?? [])).toEqual([
      2,
    ]);
    expect(await repository.listFileVersions(fileId)).toHaveLength(1);
  });

  it('does not store note links for version-history snapshots', async () => {
    const repository = new LocalRepository('repositories/version-links-test');
    await repository.initialize();

    const sourceId = await repository.createFile('Source', 'mcanvas', null);
    const targetId = await repository.createFile('Target', 'mcanvas', null);
    const note = await createCanvasNoteState(
      'See [[Target]] for context.',
      async (title) => (title === 'Target' ? targetId : null),
    );
    await repository.pushUpdates(sourceId, note.update, {
      baseRevision: null,
      localStateVector: note.stateVector,
    });

    const version = await repository.createFileVersionIfDue(sourceId);
    expect(version).not.toBeNull();

    const manifest = readManifest('repositories/version-links-test');
    expect(manifest.linksBySource[sourceId]).toBeDefined();
    expect(manifest.linksBySource[version?.id ?? '']).toBeUndefined();
  });

  it('removes version history and stored bytes when the source file is deleted', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    const repository = new LocalRepository('repositories/version-delete-test');
    await repository.initialize();

    const fileId = await repository.createFile(
      'Photo.png',
      'png',
      null,
      new Uint8Array([1]),
    );

    vi.setSystemTime(new Date('2026-01-01T00:11:00Z'));
    await repository.writeFileBytes(fileId, new Uint8Array([2]));
    const version = await repository.createFileVersionIfDue(fileId);
    expect(version).not.toBeNull();
    expect(await repository.listFileVersions(fileId)).toHaveLength(1);

    await repository.deleteNode(fileId);

    expect(await repository.listFileVersions(fileId)).toHaveLength(0);
    expect(await repository.readFileBytes(version?.id ?? '')).toBeNull();

    const manifest = readManifest('repositories/version-delete-test');
    expect(manifest.nodes[version?.id ?? '']).toBeUndefined();
    expect(
      Object.values(manifest.nodes).some(
        (node) => node.type === 'file' && node.system?.kind === 'file-version',
      ),
    ).toBe(false);
  });
});
