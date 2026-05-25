import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getRepositoryTestStorage,
  resetRepositoryTestDoubles,
} from '@/test/repository-test-utils';
import { LocalRepository } from './local';
import type { VFSManifest } from './shared';

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
      (await repository.searchNodes('Photo')).map((node) => node.id),
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
});
