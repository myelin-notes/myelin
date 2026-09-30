import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createCanvasNoteState,
  getRepositoryTestStorage,
  resetRepositoryTestDoubles,
} from '@/test/repository-test-utils';
import { TestRepository } from '@/test/test-repository';
import type { VFSManifest } from './shared';

describe('repository file version history', () => {
  beforeEach(() => {
    resetRepositoryTestDoubles();
    vi.useRealTimers();
  });

  it('stores versions as hidden repository files', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    const repository = new TestRepository('repositories/version-hidden-test');
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

    const manifest = JSON.parse(
      getRepositoryTestStorage().readText(
        'repositories/version-hidden-test/manifest.json',
      ) ?? '{}',
    ) as VFSManifest;
    expect(Object.keys(manifest.nodes)).toHaveLength(3);
  });

  it('creates versions only when the file changed and the interval has passed', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    const repository = new TestRepository('repositories/version-cadence-test');
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

  it('keeps the latest 32 versions', async () => {
    vi.useFakeTimers();

    const repository = new TestRepository(
      'repositories/version-retention-test',
    );
    await repository.initialize();

    const fileId = await repository.createFile(
      'Photo.png',
      'png',
      null,
      new Uint8Array([0]),
    );

    for (let index = 0; index < 33; index += 1) {
      vi.setSystemTime(new Date(Date.UTC(2026, 0, 1, 0, index * 11)));
      await repository.writeFileBytes(fileId, new Uint8Array([index]));
      await repository.createFileVersionIfDue(fileId);
    }

    const versions = await repository.listFileVersions(fileId);
    expect(versions).toHaveLength(32);
    expect(
      Array.from((await repository.readFileBytes(versions[31].id)) ?? []),
    ).toEqual([1]);
  });

  it('does not store note links for version-history snapshots', async () => {
    const repository = new TestRepository('repositories/version-links-test');
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

    const manifest = JSON.parse(
      getRepositoryTestStorage().readText(
        'repositories/version-links-test/manifest.json',
      ) ?? '{}',
    ) as VFSManifest;
    expect(manifest.linksBySource[sourceId]).toBeDefined();
    expect(manifest.linksBySource[version?.id ?? '']).toBeUndefined();
  });

  it('removes version history and stored bytes when the source file is deleted', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    const repository = new TestRepository('repositories/version-delete-test');
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

    const manifest = JSON.parse(
      getRepositoryTestStorage().readText(
        'repositories/version-delete-test/manifest.json',
      ) ?? '{}',
    ) as VFSManifest;
    expect(manifest.nodes[version?.id ?? '']).toBeUndefined();
    expect(
      Object.values(manifest.nodes).some(
        (node) => node.type === 'file' && node.system?.kind === 'file-version',
      ),
    ).toBe(false);
  });
});
