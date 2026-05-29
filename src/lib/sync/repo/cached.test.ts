import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import {
  createNoteState,
  getRepositoryTestStorage,
  readNoteText,
  resetRepositoryTestDoubles,
} from '@/test/repository-test-utils';
import { BaseRepository } from './base';
import { CachedRepository } from './cached';
import { GitHubRepository } from './github';
import { LocalRepository } from './local';
import {
  computeRevision,
  createEmptyManifest,
  getStoredFileName,
  type VFSManifest,
} from './shared';
import type { RepositoryCapabilities, VFSFileNode, VFSNodeId } from './types';

class MemoryRemoteRepository extends BaseRepository {
  public readonly kind = 'memory-remote';
  public readonly capabilities: RepositoryCapabilities = {
    polling: false,
    liveSync: false,
    batchedCommit: false,
  };

  private manifest: VFSManifest = createEmptyManifest();
  private manifestRevision: string | null = null;
  private readonly notes = new Map<VFSNodeId, Uint8Array>();
  private noteRevision = 0;
  private manifestVersion = 0;
  private loadFileBytesGate: Promise<void> | null = null;
  private onLoadFileBytesBlocked: (() => void) | null = null;
  private saveFileBytesGate: Promise<void> | null = null;
  private onSaveFileBytesBlocked: (() => void) | null = null;

  blockFileLoads(gate: Promise<void>, onBlocked?: () => void): void {
    this.loadFileBytesGate = gate;
    this.onLoadFileBytesBlocked = onBlocked ?? null;
  }

  blockFileSaves(gate: Promise<void>, onBlocked?: () => void): void {
    this.saveFileBytesGate = gate;
    this.onSaveFileBytesBlocked = onBlocked ?? null;
  }

  protected async loadManifestImpl(): Promise<{
    manifest: VFSManifest;
    revision: string | null;
  }> {
    return {
      manifest: structuredClone(this.manifest),
      revision: this.manifestRevision,
    };
  }

  protected async saveManifestImpl(
    manifest: VFSManifest,
    _revision: string | null,
    _action: string,
  ): Promise<string> {
    this.manifest = structuredClone(manifest);
    this.manifestRevision = `manifest-${++this.manifestVersion}`;
    return this.manifestRevision;
  }

  protected async loadFileBytes(nodeId: VFSNodeId): Promise<{
    bytes: Uint8Array | null;
    revision: string | null;
  }> {
    if (this.loadFileBytesGate) {
      this.onLoadFileBytesBlocked?.();
      await this.loadFileBytesGate;
    }

    const bytes = this.notes.get(nodeId) ?? null;
    return {
      bytes: bytes ? new Uint8Array(bytes) : null,
      revision: bytes ? await computeRevision(bytes) : null,
    };
  }

  protected async saveFileBytes(
    nodeId: VFSNodeId,
    bytes: Uint8Array,
    _revision: string | null,
    _message: string,
  ): Promise<string> {
    if (this.saveFileBytesGate) {
      this.onSaveFileBytesBlocked?.();
      await this.saveFileBytesGate;
    }

    this.notes.set(nodeId, new Uint8Array(bytes));
    return `note-${++this.noteRevision}`;
  }

  protected async deleteFileBytes(nodeId: VFSNodeId): Promise<void> {
    this.notes.delete(nodeId);
  }
}

function createDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

async function expectQuickLocalResult<T>(promise: Promise<T>): Promise<T> {
  const timedOut = Symbol('timedOut');
  const result = await Promise.race([
    promise,
    new Promise<typeof timedOut>((resolve) => {
      setTimeout(() => resolve(timedOut), 250);
    }),
  ]);
  expect(result).not.toBe(timedOut);
  return result as T;
}

async function waitForCondition(condition: () => boolean): Promise<void> {
  for (let index = 0; index < 50; index += 1) {
    if (condition()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  expect(condition()).toBe(true);
}

function installMemoryLocalStorage(): void {
  const storage = new Map<string, string>();

  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem(key: string) {
        return storage.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        storage.set(key, value);
      },
      removeItem(key: string) {
        storage.delete(key);
      },
      clear() {
        storage.clear();
      },
      key(index: number) {
        return Array.from(storage.keys())[index] ?? null;
      },
      get length() {
        return storage.size;
      },
    } satisfies Storage,
  });
}

describe('CachedRepository', () => {
  beforeEach(() => {
    resetRepositoryTestDoubles();
    installMemoryLocalStorage();
    vi.useRealTimers();
  });

  it('serves cache writes immediately and flushes them to remote', async () => {
    const remote = new MemoryRemoteRepository();
    const cache = new LocalRepository('repositories/cached-test');
    const repository = new CachedRepository(
      remote,
      cache,
      'repositories/cached-test/outbox.json',
    );

    await repository.initialize();

    const fileId = await repository.createFile('Offline note', 'mcanvas', null);
    const note = createNoteState('hello cached repository');

    await repository.pushUpdates(fileId, note.update, {
      baseRevision: null,
      localStateVector: note.stateVector,
    });

    const [folders, files] = await repository.listDirectory(null);
    expect(folders).toHaveLength(0);
    expect(files).toHaveLength(1);
    expect(files[0]?.id).toBe(fileId);
    expect(repository.getRuntimeStatus().pendingRemoteWrites).toBe(2);

    await repository.flushPending();

    const remoteSnapshot = await remote.exportSnapshot();
    expect(remoteSnapshot.manifest.nodes[fileId]?.type).toBe('file');
    expect(readNoteText(remoteSnapshot.notes[fileId] ?? null)).toBe(
      'hello cached repository',
    );
    expect(repository.getRuntimeStatus().pendingRemoteWrites).toBe(0);
  });

  it('flushes raw video file bytes to remote storage', async () => {
    const remote = new MemoryRemoteRepository();
    const cache = new LocalRepository('repositories/cached-video-test');
    const repository = new CachedRepository(
      remote,
      cache,
      'repositories/cached-video-test/outbox.json',
    );
    const bytes = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]);

    await repository.initialize();

    const fileId = await repository.createFile('Clip.mp4', 'mp4', null, bytes);

    expect(Array.from((await repository.readFileBytes(fileId)) ?? [])).toEqual(
      Array.from(bytes),
    );
    expect(repository.getRuntimeStatus().pendingRemoteWrites).toBe(2);

    await repository.flushPending();

    const remoteSnapshot = await remote.exportSnapshot();
    expect(remoteSnapshot.manifest.nodes[fileId]).toMatchObject({
      type: 'file',
      fileType: 'mp4',
      name: 'Clip.mp4',
    });
    expect(Array.from(remoteSnapshot.notes[fileId] ?? [])).toEqual(
      Array.from(bytes),
    );
    expect(repository.getRuntimeStatus().pendingRemoteWrites).toBe(0);
  });

  it('queues version history files through the regular outbox', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    const remote = new MemoryRemoteRepository();
    const cache = new LocalRepository('repositories/cached-version-test');
    const repository = new CachedRepository(
      remote,
      cache,
      'repositories/cached-version-test/outbox.json',
    );

    await repository.initialize();

    const fileId = await repository.createFile(
      'Photo.png',
      'png',
      null,
      new Uint8Array([1, 2, 3]),
    );

    const version = await repository.createFileVersionIfDue(fileId);

    expect(version).not.toBeNull();
    expect(repository.getRuntimeStatus().pendingRemoteWrites).toBe(5);

    await repository.flushPending();

    const remoteSnapshot = await remote.exportSnapshot();
    expect(remoteSnapshot.manifest.nodes[fileId]).toMatchObject({
      type: 'file',
      name: 'Photo.png',
    });
    expect(remoteSnapshot.manifest.nodes[version?.id ?? '']).toMatchObject({
      type: 'file',
      system: {
        kind: 'file-version',
        sourceFileId: fileId,
      },
    });
    expect(Array.from(remoteSnapshot.notes[version?.id ?? ''] ?? [])).toEqual([
      1, 2, 3,
    ]);
    expect(repository.getRuntimeStatus().pendingRemoteWrites).toBe(0);
  });

  it('does not queue cached restore when version bytes are missing', async () => {
    const remote = new MemoryRemoteRepository();
    const cache = new LocalRepository(
      'repositories/cached-missing-version-test',
    );
    const repository = new CachedRepository(
      remote,
      cache,
      'repositories/cached-missing-version-test/outbox.json',
    );

    await repository.initialize();

    const fileId = await repository.createFile(
      'Photo.png',
      'png',
      null,
      new Uint8Array([1]),
    );
    const version = await repository.createFileVersionIfDue(fileId);
    expect(version).not.toBeNull();

    await repository.flushPending();
    await repository.writeFileBytes(fileId, new Uint8Array([2]));
    const pendingBeforeRestore =
      repository.getRuntimeStatus().pendingRemoteWrites;

    await getRepositoryTestStorage().remove(
      `repositories/cached-missing-version-test/files/${getStoredFileName({
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
    expect(repository.getRuntimeStatus().pendingRemoteWrites).toBe(
      pendingBeforeRestore,
    );
  });

  it('flushes restored canvas versions as replacements', async () => {
    const remote = new MemoryRemoteRepository();
    const oldNote = createNoteState('old version');
    const fileId = await remote.createFile(
      'Remote note',
      'mcanvas',
      null,
      oldNote.update,
    );

    const cache = new LocalRepository(
      'repositories/canvas-restore-replace-test',
    );
    const repository = new CachedRepository(
      remote,
      cache,
      'repositories/canvas-restore-replace-test/outbox.json',
    );

    await repository.initialize();
    const version = await repository.createFileVersionIfDue(fileId, {
      force: true,
    });
    expect(version).not.toBeNull();

    const newerRemoteNote = createNoteState('newer remote version');
    await repository.writeFileBytes(fileId, newerRemoteNote.update);
    await repository.flushPending();

    await repository.restoreFileVersion(fileId, version?.id ?? '');
    await repository.flushPending();

    expect(readNoteText((await remote.loadDocument(fileId)).update)).toBe(
      'old version',
    );
    expect(readNoteText((await repository.loadDocument(fileId)).update)).toBe(
      'old version',
    );
  });

  it('does not overwrite newer remote state when restoring the current cache state', async () => {
    const remote = new MemoryRemoteRepository();
    const oldNote = createNoteState('old version');
    const fileId = await remote.createFile(
      'Remote note',
      'mcanvas',
      null,
      oldNote.update,
    );

    const cache = new LocalRepository('repositories/current-restore-noop-test');
    const repository = new CachedRepository(
      remote,
      cache,
      'repositories/current-restore-noop-test/outbox.json',
    );

    await repository.initialize();
    const version = await repository.createFileVersionIfDue(fileId, {
      force: true,
    });
    expect(version).not.toBeNull();
    await repository.flushPending();

    const newerRemoteNote = createNoteState('newer remote version');
    await remote.writeFileBytes(fileId, newerRemoteNote.update);

    await repository.restoreFileVersion(fileId, version?.id ?? '');
    expect(repository.getRuntimeStatus().pendingRemoteWrites).toBe(0);

    await repository.flushPending();

    expect(readNoteText((await remote.loadDocument(fileId)).update)).toBe(
      'newer remote version',
    );
    expect(readNoteText((await repository.loadDocument(fileId)).update)).toBe(
      'old version',
    );
  });

  it('does not pull remote state over an unflushed canvas restore', async () => {
    const remote = new MemoryRemoteRepository();
    const oldNote = createNoteState('old version');
    const fileId = await remote.createFile(
      'Remote note',
      'mcanvas',
      null,
      oldNote.update,
    );

    const cache = new LocalRepository(
      'repositories/canvas-restore-open-session-test',
    );
    const repository = new CachedRepository(
      remote,
      cache,
      'repositories/canvas-restore-open-session-test/outbox.json',
    );

    await repository.initialize();
    const version = await repository.createFileVersionIfDue(fileId, {
      force: true,
    });
    expect(version).not.toBeNull();

    const currentNote = createNoteState('current version');
    await repository.writeFileBytes(fileId, currentNote.update);
    await repository.flushPending();

    const newerRemoteNote = createNoteState('newer remote version');
    await remote.writeFileBytes(fileId, newerRemoteNote.update);

    await repository.restoreFileVersion(fileId, version?.id ?? '');

    const remotePullUpdates = vi.spyOn(remote, 'pullUpdates');
    const session = await repository.openSession(fileId);

    expect(readNoteText(session.encodeUpdate())).toBe('old version');

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(remotePullUpdates).not.toHaveBeenCalled();
    expect(readNoteText(session.encodeUpdate())).toBe('old version');

    await session.close();
  });

  it('does not apply an in-flight remote pull after a canvas restore queues replacement', async () => {
    const remote = new MemoryRemoteRepository();
    const oldNote = createNoteState('old version');
    const fileId = await remote.createFile(
      'Remote note',
      'mcanvas',
      null,
      oldNote.update,
    );

    const cache = new LocalRepository(
      'repositories/canvas-restore-inflight-pull-test',
    );
    const repository = new CachedRepository(
      remote,
      cache,
      'repositories/canvas-restore-inflight-pull-test/outbox.json',
    );

    await repository.initialize();
    const version = await repository.createFileVersionIfDue(fileId, {
      force: true,
    });
    expect(version).not.toBeNull();

    const currentNote = createNoteState('current version');
    await repository.writeFileBytes(fileId, currentNote.update);
    await repository.flushPending();

    const newerRemoteNote = createNoteState('newer remote version');
    await remote.writeFileBytes(fileId, newerRemoteNote.update);

    const remotePullGate = createDeferred();
    const remotePullBlocked = createDeferred();
    remote.blockFileLoads(remotePullGate.promise, remotePullBlocked.resolve);

    const session = await repository.openSession(fileId);
    await remotePullBlocked.promise;

    await repository.restoreFileVersion(fileId, version?.id ?? '');

    remotePullGate.resolve();
    await waitForCondition(
      () => repository.getRuntimeStatus().lastRemoteSyncAt !== null,
    );

    expect(readNoteText((await repository.loadDocument(fileId)).update)).toBe(
      'old version',
    );

    await session.close();
    const reopened = await repository.openSession(fileId);
    expect(readNoteText(reopened.encodeUpdate())).toBe('old version');
    await reopened.close();
  });

  it('updates the original raw file when the remote has not changed', async () => {
    const remote = new MemoryRemoteRepository();
    const initialBytes = new Uint8Array([1, 2, 3]);
    const updatedBytes = new Uint8Array([4, 5, 6]);
    const fileId = await remote.createFile(
      'Clip.mp4',
      'mp4',
      null,
      initialBytes,
    );

    const cache = new LocalRepository('repositories/raw-update-test');
    const repository = new CachedRepository(
      remote,
      cache,
      'repositories/raw-update-test/outbox.json',
    );

    await repository.initialize();
    await repository.writeFileBytes(fileId, updatedBytes);
    await repository.flushPending();

    const remoteSnapshot = await remote.exportSnapshot();
    const remoteFiles = Object.values(remoteSnapshot.manifest.nodes).filter(
      (node): node is VFSFileNode => node.type === 'file',
    );

    expect(remoteFiles).toHaveLength(1);
    expect(remoteFiles[0]).toMatchObject({
      id: fileId,
      fileType: 'mp4',
      name: 'Clip.mp4',
    });
    expect(Array.from(remoteSnapshot.notes[fileId] ?? [])).toEqual(
      Array.from(updatedBytes),
    );
    expect(repository.getRuntimeStatus().pendingRemoteWrites).toBe(0);
  });

  it('pulls newer raw file state when there are no local changes', async () => {
    const remote = new MemoryRemoteRepository();
    const initialBytes = new Uint8Array([1, 2, 3]);
    const remoteBytes = new Uint8Array([4, 5, 6]);
    const fileId = await remote.createFile(
      'Clip.mp4',
      'mp4',
      null,
      initialBytes,
    );

    const cache = new LocalRepository('repositories/raw-refresh-test');
    const repository = new CachedRepository(
      remote,
      cache,
      'repositories/raw-refresh-test/outbox.json',
    );

    await repository.initialize();
    await remote.writeFileBytes(fileId, remoteBytes);
    await repository.refresh();

    const remoteSnapshot = await remote.exportSnapshot();
    const remoteFiles = Object.values(remoteSnapshot.manifest.nodes).filter(
      (node): node is VFSFileNode => node.type === 'file',
    );

    expect(remoteFiles).toHaveLength(1);
    expect(remoteFiles[0]?.id).toBe(fileId);
    expect(Array.from(remoteSnapshot.notes[fileId] ?? [])).toEqual(
      Array.from(remoteBytes),
    );
    expect(Array.from((await repository.readFileBytes(fileId)) ?? [])).toEqual(
      Array.from(remoteBytes),
    );
    expect(repository.getRuntimeStatus().pendingRemoteWrites).toBe(0);
  });

  it('preserves remote raw file changes by creating a conflict copy', async () => {
    const remote = new MemoryRemoteRepository();
    const initialBytes = new Uint8Array([1, 2, 3]);
    const remoteBytes = new Uint8Array([4, 5, 6]);
    const localBytes = new Uint8Array([7, 8, 9]);
    const fileId = await remote.createFile(
      'Clip.mp4',
      'mp4',
      null,
      initialBytes,
    );

    const cache = new LocalRepository('repositories/raw-conflict-test');
    const repository = new CachedRepository(
      remote,
      cache,
      'repositories/raw-conflict-test/outbox.json',
    );

    await repository.initialize();
    await remote.writeFileBytes(fileId, remoteBytes);
    await repository.writeFileBytes(fileId, localBytes);

    await repository.flushPending();

    const remoteSnapshot = await remote.exportSnapshot();
    const remoteFiles = Object.values(remoteSnapshot.manifest.nodes).filter(
      (node): node is VFSFileNode => node.type === 'file',
    );
    const conflictNode = remoteFiles.find((node) =>
      node.name.startsWith('Clip (Conflicted copy '),
    );

    expect(Array.from(remoteSnapshot.notes[fileId] ?? [])).toEqual(
      Array.from(remoteBytes),
    );
    expect(conflictNode).toMatchObject({
      fileType: 'mp4',
      parentId: null,
    });
    expect(
      Array.from(remoteSnapshot.notes[conflictNode?.id ?? ''] ?? []),
    ).toEqual(Array.from(localBytes));
    expect(Array.from((await repository.readFileBytes(fileId)) ?? [])).toEqual(
      Array.from(remoteBytes),
    );
    expect(
      Array.from(
        (await repository.readFileBytes(conflictNode?.id ?? '')) ?? [],
      ),
    ).toEqual(Array.from(localBytes));
    expect(repository.getRuntimeStatus().pendingRemoteWrites).toBe(0);
  });

  it('hydrates the cache from remote state on initialize', async () => {
    const remote = new MemoryRemoteRepository();
    const fileId = await remote.createFile('Remote note', 'mcanvas', null);
    const note = createNoteState('fetched from remote');

    await remote.pushUpdates(fileId, note.update, {
      baseRevision: null,
      localStateVector: note.stateVector,
    });

    const cache = new LocalRepository('repositories/bootstrap-test');
    const repository = new CachedRepository(
      remote,
      cache,
      'repositories/bootstrap-test/outbox.json',
    );

    await repository.initialize();

    const [folders, files] = await repository.listDirectory(null);
    expect(folders).toHaveLength(0);
    expect(files).toHaveLength(1);
    expect(files[0]?.id).toBe(fileId);

    const snapshot = await repository.loadDocument(fileId);
    expect(readNoteText(snapshot.update)).toBe('fetched from remote');
  });

  it('does not immediately resync after a clean remote bootstrap', async () => {
    const remote = new MemoryRemoteRepository();
    const fileId = await remote.createFile('Remote note', 'mcanvas', null);
    const note = createNoteState('single bootstrap sync');

    await remote.pushUpdates(fileId, note.update, {
      baseRevision: null,
      localStateVector: note.stateVector,
    });

    const cache = new LocalRepository('repositories/single-bootstrap-test');
    const repository = new CachedRepository(
      remote,
      cache,
      'repositories/single-bootstrap-test/outbox.json',
    );
    const exportSnapshot = vi.spyOn(remote, 'exportSnapshot');
    const replaceSnapshot = vi.spyOn(cache, 'replaceSnapshot');

    await repository.initialize();

    expect(exportSnapshot).toHaveBeenCalledTimes(1);
    expect(replaceSnapshot).toHaveBeenCalledTimes(1);
    expect(readNoteText((await repository.loadDocument(fileId)).update)).toBe(
      'single bootstrap sync',
    );
  });

  it('preserves pending outbox work across initialize without pushing to remote', async () => {
    const remote = new MemoryRemoteRepository();
    const fileId = await remote.createFile('Remote note', 'mcanvas', null);
    const initialNote = createNoteState('remote baseline');

    await remote.pushUpdates(fileId, initialNote.update, {
      baseRevision: null,
      localStateVector: initialNote.stateVector,
    });

    const cache = new LocalRepository('repositories/pending-bootstrap-test');
    const outboxPath = 'repositories/pending-bootstrap-test/outbox.json';
    await cache.replaceSnapshot(await remote.exportSnapshot());

    const cacheSnapshot = await cache.loadDocument(fileId);
    const doc = new Y.Doc();
    if (cacheSnapshot.update) {
      Y.applyUpdate(doc, cacheSnapshot.update);
    }
    const text = doc.getText('content');
    text.delete(0, text.length);
    text.insert(0, 'local pending edit');

    await cache.pushUpdates(
      fileId,
      Y.encodeStateAsUpdate(doc, cacheSnapshot.stateVector),
      {
        baseRevision: cacheSnapshot.revision,
        localStateVector: Y.encodeStateVector(doc),
      },
    );

    await getRepositoryTestStorage().writeTextFile(
      outboxPath,
      JSON.stringify([{ kind: 'push-note', nodeId: fileId }]),
    );

    const repository = new CachedRepository(remote, cache, outboxPath);

    await repository.initialize();

    // Remote unchanged because init no longer flushes the outbox.
    expect(readNoteText((await remote.loadDocument(fileId)).update)).toBe(
      'remote baseline',
    );
    // Local cache still holds the pending edit.
    expect(readNoteText((await repository.loadDocument(fileId)).update)).toBe(
      'local pending edit',
    );
    expect(repository.getRuntimeStatus().pendingRemoteWrites).toBe(1);

    // Explicit flush (timer or app-close path) drains the outbox.
    await repository.flushPending();

    expect(readNoteText((await remote.loadDocument(fileId)).update)).toBe(
      'local pending edit',
    );
    expect(repository.getRuntimeStatus().pendingRemoteWrites).toBe(0);
  });

  it('replaces preexisting cache contents from an empty remote on initialize', async () => {
    const remote = new MemoryRemoteRepository();
    const cache = new LocalRepository('repositories/cache-bootstrap-test');

    await cache.initialize();

    const fileId = await cache.createFile('Cached note', 'mcanvas', null);
    const note = createNoteState('pushed from cache bootstrap');

    await cache.pushUpdates(fileId, note.update, {
      baseRevision: null,
      localStateVector: note.stateVector,
    });

    const repository = new CachedRepository(
      remote,
      cache,
      'repositories/cache-bootstrap-test/outbox.json',
    );

    await repository.initialize();

    const [folders, files] = await repository.listDirectory(null);
    const remoteSnapshot = await remote.exportSnapshot();

    expect(folders).toHaveLength(0);
    expect(files).toHaveLength(0);
    expect(await repository.getNode(fileId)).toBeNull();
    expect(remoteSnapshot.manifest).toEqual(createEmptyManifest());
    expect(remoteSnapshot.notes).toEqual({});
    expect(repository.getRuntimeStatus().pendingRemoteWrites).toBe(0);
  });

  it('replaces cached custom colors from an empty remote on initialize', async () => {
    const remote = new MemoryRemoteRepository();
    const cache = new LocalRepository('repositories/color-bootstrap-test');

    await cache.initialize();
    await cache.addCustomColor('#ABCDEF');

    const repository = new CachedRepository(
      remote,
      cache,
      'repositories/color-bootstrap-test/outbox.json',
    );

    await repository.initialize();

    expect(await remote.getCustomColors()).toEqual([]);
    expect(await repository.getCustomColors()).toEqual([]);
    expect(repository.getRuntimeStatus().pendingRemoteWrites).toBe(0);
  });

  it('applies metadata and color writes locally before remote flush', async () => {
    const remote = new MemoryRemoteRepository();
    const cache = new LocalRepository('repositories/local-first-metadata-test');
    const repository = new CachedRepository(
      remote,
      cache,
      'repositories/local-first-metadata-test/outbox.json',
    );

    await repository.initialize();

    const folderId = await repository.createFolder('Drafts', null);
    const fileId = await repository.createFile(
      'Local note',
      'mcanvas',
      folderId,
    );
    await repository.renameNode(fileId, 'Renamed local note');
    await repository.moveNode(fileId, null);
    await repository.setTags(fileId, ['local']);
    await repository.addCustomColor('#ABCDEF');

    const [rootFolders, rootFiles] = await repository.listDirectory(null);
    const remoteBeforeFlush = await remote.exportSnapshot();

    expect(rootFolders.map((folder) => folder.id)).toEqual([folderId]);
    expect(rootFiles).toHaveLength(1);
    expect(rootFiles[0]).toMatchObject({
      id: fileId,
      name: 'Renamed local note',
      parentId: null,
      tags: ['local'],
    });
    expect(await repository.getCustomColors()).toEqual(['#abcdef']);
    expect(remoteBeforeFlush.manifest).toEqual(createEmptyManifest());
    expect(remoteBeforeFlush.notes).toEqual({});
    expect(repository.getRuntimeStatus().pendingRemoteWrites).toBeGreaterThan(
      0,
    );

    await repository.flushPending();

    const [remoteFolders, remoteFiles] = await remote.listDirectory(null);
    expect(remoteFolders.map((folder) => folder.id)).toEqual([folderId]);
    expect(remoteFiles).toHaveLength(1);
    expect(remoteFiles[0]).toMatchObject({
      id: fileId,
      name: 'Renamed local note',
      parentId: null,
      tags: ['local'],
    });
    expect(await remote.getCustomColors()).toEqual(['#abcdef']);
    expect(repository.getRuntimeStatus().pendingRemoteWrites).toBe(0);
  });

  it('collapses create and delete work into a single pending delete before flush', async () => {
    const remote = new MemoryRemoteRepository();
    const cache = new LocalRepository('repositories/pending-delete-test');
    const repository = new CachedRepository(
      remote,
      cache,
      'repositories/pending-delete-test/outbox.json',
    );

    await repository.initialize();

    const fileId = await repository.createFile(
      'Transient note',
      'mcanvas',
      null,
    );
    const note = createNoteState('temporary content');

    await repository.pushUpdates(fileId, note.update, {
      baseRevision: null,
      localStateVector: note.stateVector,
    });
    await repository.deleteNode(fileId);

    expect(repository.getRuntimeStatus().pendingRemoteWrites).toBe(1);

    const storage = getRepositoryTestStorage();
    const outbox = storage.readText(
      'repositories/pending-delete-test/outbox.json',
    );
    expect(outbox).not.toBeNull();
    expect(JSON.parse(outbox ?? '[]')).toEqual([
      expect.objectContaining({
        kind: 'delete-manifest-node',
        nodeId: fileId,
        deletedFileIds: [fileId],
      }),
    ]);

    await repository.flushPending();

    const remoteSnapshot = await remote.exportSnapshot();
    expect(remoteSnapshot.manifest.nodes[fileId]).toBeUndefined();
    expect(fileId in remoteSnapshot.notes).toBe(false);
    expect(repository.getRuntimeStatus().pendingRemoteWrites).toBe(0);
  });

  it('propagates synced subtree deletions to the remote repository', async () => {
    const remote = new MemoryRemoteRepository();
    const cache = new LocalRepository('repositories/delete-sync-test');
    const repository = new CachedRepository(
      remote,
      cache,
      'repositories/delete-sync-test/outbox.json',
    );

    await repository.initialize();

    const folderId = await repository.createFolder('Docs', null);
    const fileId = await repository.createFile(
      'Nested note',
      'mcanvas',
      folderId,
    );
    const note = createNoteState('nested remote delete');

    await repository.pushUpdates(fileId, note.update, {
      baseRevision: null,
      localStateVector: note.stateVector,
    });
    await repository.flushPending();

    await repository.deleteNode(folderId);
    expect(repository.getRuntimeStatus().pendingRemoteWrites).toBe(1);

    await repository.flushPending();

    const remoteSnapshot = await remote.exportSnapshot();
    expect(remoteSnapshot.manifest.nodes[folderId]).toBeUndefined();
    expect(remoteSnapshot.manifest.nodes[fileId]).toBeUndefined();
    expect(fileId in remoteSnapshot.notes).toBe(false);
  });

  it('refresh pulls newer remote state into the cache', async () => {
    const remote = new MemoryRemoteRepository();
    const cache = new LocalRepository('repositories/refresh-remote-test');
    const repository = new CachedRepository(
      remote,
      cache,
      'repositories/refresh-remote-test/outbox.json',
    );

    await repository.initialize();

    const fileId = await remote.createFile('Remote later', 'mcanvas', null);
    const note = createNoteState('loaded by refresh');

    await remote.pushUpdates(fileId, note.update, {
      baseRevision: null,
      localStateVector: note.stateVector,
    });
    await repository.refresh();

    const [folders, files] = await repository.listDirectory(null);
    expect(folders).toHaveLength(0);
    expect(files).toHaveLength(1);
    expect(files[0]?.id).toBe(fileId);

    const snapshot = await repository.loadDocument(fileId);
    expect(readNoteText(snapshot.update)).toBe('loaded by refresh');
  });

  it('refresh replaces stale cache contents from an empty remote', async () => {
    const remote = new MemoryRemoteRepository();
    const fileId = await remote.createFile('Remote note', 'mcanvas', null);
    const note = createNoteState('removed remotely');

    await remote.pushUpdates(fileId, note.update, {
      baseRevision: null,
      localStateVector: note.stateVector,
    });

    const cache = new LocalRepository('repositories/refresh-empty-test');
    const repository = new CachedRepository(
      remote,
      cache,
      'repositories/refresh-empty-test/outbox.json',
    );

    await repository.initialize();

    expect(await repository.getNode(fileId)).not.toBeNull();

    await remote.deleteNode(fileId);
    await repository.refresh();

    const [folders, files] = await repository.listDirectory(null);
    expect(folders).toHaveLength(0);
    expect(files).toHaveLength(0);
    expect(await repository.getNode(fileId)).toBeNull();
    expect(repository.getRuntimeStatus().pendingRemoteWrites).toBe(0);
  });

  it('preserves remote siblings when flushing cached manifest upserts', async () => {
    const remote = new MemoryRemoteRepository();
    const folderId = await remote.createFolder('Shared folder', null);
    const cache = new LocalRepository('repositories/upsert-sibling-test');
    const repository = new CachedRepository(
      remote,
      cache,
      'repositories/upsert-sibling-test/outbox.json',
    );

    await repository.initialize();

    const remoteRootId = await remote.createFile(
      'Remote root sibling',
      'mcanvas',
      null,
    );
    const remoteNestedId = await remote.createFile(
      'Remote nested sibling',
      'mcanvas',
      folderId,
    );
    await remote.renameNode(folderId, 'Remote renamed folder');
    const localRootId = await repository.createFile(
      'Local root file',
      'mcanvas',
      null,
    );
    const localNestedId = await repository.createFile(
      'Local nested file',
      'mcanvas',
      folderId,
    );

    await repository.flushPending();

    const [, rootFiles] = await remote.listDirectory(null);
    const [, nestedFiles] = await remote.listDirectory(folderId);

    expect(rootFiles.map((file) => file.id).sort()).toEqual(
      [localRootId, remoteRootId].sort(),
    );
    expect(nestedFiles.map((file) => file.id).sort()).toEqual(
      [localNestedId, remoteNestedId].sort(),
    );
    expect((await remote.getNode(folderId))?.name).toBe(
      'Remote renamed folder',
    );
  });

  it('opens a cached session before the remote note refresh completes', async () => {
    const remote = new MemoryRemoteRepository();
    const fileId = await remote.createFile('Remote later', 'mcanvas', null);
    const initialNote = createNoteState('stale cache copy');

    await remote.pushUpdates(fileId, initialNote.update, {
      baseRevision: null,
      localStateVector: initialNote.stateVector,
    });

    const cache = new LocalRepository('repositories/open-session-refresh-test');
    const repository = new CachedRepository(
      remote,
      cache,
      'repositories/open-session-refresh-test/outbox.json',
    );

    await repository.initialize();

    const remoteSnapshot = await remote.loadDocument(fileId);
    const doc = new Y.Doc();
    if (remoteSnapshot.update) {
      Y.applyUpdate(doc, remoteSnapshot.update);
    }
    const text = doc.getText('content');
    text.delete(0, text.length);
    text.insert(0, 'opened latest remote');

    await remote.pushUpdates(
      fileId,
      Y.encodeStateAsUpdate(doc, remoteSnapshot.stateVector),
      {
        baseRevision: remoteSnapshot.revision,
        localStateVector: Y.encodeStateVector(doc),
      },
    );

    const exportSnapshot = vi.spyOn(remote, 'exportSnapshot');
    const remoteRefresh = createDeferred();
    const reachedRemoteFileLoad = createDeferred();
    remote.blockFileLoads(remoteRefresh.promise, reachedRemoteFileLoad.resolve);

    const session = await expectQuickLocalResult(
      repository.openSession(fileId),
    );

    expect(readNoteText(session.encodeUpdate())).toBe('stale cache copy');
    expect(exportSnapshot).not.toHaveBeenCalled();

    await expectQuickLocalResult(reachedRemoteFileLoad.promise);
    remoteRefresh.resolve();
    await waitForCondition(
      () => readNoteText(session.encodeUpdate()) === 'opened latest remote',
    );

    expect(readNoteText((await repository.loadDocument(fileId)).update)).toBe(
      'opened latest remote',
    );

    await session.close();
  });

  it('pulls cached session updates without fetching from the remote', async () => {
    const remote = new MemoryRemoteRepository();
    const fileId = await remote.createFile('Remote note', 'mcanvas', null);
    const initialNote = createNoteState('base');

    await remote.pushUpdates(fileId, initialNote.update, {
      baseRevision: null,
      localStateVector: initialNote.stateVector,
    });

    const cache = new LocalRepository('repositories/pull-cache-only-test');
    const repository = new CachedRepository(
      remote,
      cache,
      'repositories/pull-cache-only-test/outbox.json',
    );

    await repository.initialize();

    const remoteSnapshot = await remote.loadDocument(fileId);
    const doc = new Y.Doc();
    if (remoteSnapshot.update) {
      Y.applyUpdate(doc, remoteSnapshot.update);
    }
    doc.getText('content').insert(4, ' remote');

    await remote.pushUpdates(
      fileId,
      Y.encodeStateAsUpdate(doc, remoteSnapshot.stateVector),
      {
        baseRevision: remoteSnapshot.revision,
        localStateVector: Y.encodeStateVector(doc),
      },
    );

    const remotePullUpdates = vi.spyOn(remote, 'pullUpdates');

    const snapshot = await expectQuickLocalResult(
      repository.pullUpdates(fileId, null),
    );

    expect(readNoteText(snapshot.update)).toBe('base');
    expect(remotePullUpdates).not.toHaveBeenCalled();
  });

  it('keeps the repository online when remote note cache merge loses a local race', async () => {
    const remote = new MemoryRemoteRepository();
    const fileId = await remote.createFile('Remote note', 'mcanvas', null);
    const initialNote = createNoteState('base');

    await remote.pushUpdates(fileId, initialNote.update, {
      baseRevision: null,
      localStateVector: initialNote.stateVector,
    });

    const cache = new LocalRepository('repositories/open-session-race-test');
    const repository = new CachedRepository(
      remote,
      cache,
      'repositories/open-session-race-test/outbox.json',
    );

    await repository.initialize();

    const remoteSnapshot = await remote.loadDocument(fileId);
    const doc = new Y.Doc();
    if (remoteSnapshot.update) {
      Y.applyUpdate(doc, remoteSnapshot.update);
    }
    doc.getText('content').insert(4, ' remote');

    await remote.pushUpdates(
      fileId,
      Y.encodeStateAsUpdate(doc, remoteSnapshot.stateVector),
      {
        baseRevision: remoteSnapshot.revision,
        localStateVector: Y.encodeStateVector(doc),
      },
    );

    vi.spyOn(cache, 'pushUpdates').mockResolvedValueOnce({
      accepted: false,
      changed: false,
      update: null,
      stateVector: new Uint8Array(),
      revision: 'cache-conflict',
      remoteUpdate: null,
    });

    const session = await repository.openSession(fileId);
    await waitForCondition(
      () =>
        repository
          .getRuntimeStatus()
          .lastError?.message.includes('Failed to merge remote note') === true,
    );

    const status = repository.getRuntimeStatus();
    expect(status.online).toBe(true);
    expect(status.lastError?.message).toContain('Failed to merge remote note');

    await session.close();
  });

  it('keeps explicit refresh available after opening a cached session', async () => {
    const remote = new MemoryRemoteRepository();
    const fileId = await remote.createFile('Remote note', 'mcanvas', null);
    const initialNote = createNoteState('base');

    await remote.pushUpdates(fileId, initialNote.update, {
      baseRevision: null,
      localStateVector: initialNote.stateVector,
    });

    const cache = new LocalRepository(
      'repositories/open-session-local-edit-test',
    );
    const repository = new CachedRepository(
      remote,
      cache,
      'repositories/open-session-local-edit-test/outbox.json',
    );

    await repository.initialize();

    const remoteSnapshot = await remote.loadDocument(fileId);
    const doc = new Y.Doc();
    if (remoteSnapshot.update) {
      Y.applyUpdate(doc, remoteSnapshot.update);
    }
    doc.getText('content').insert(4, ' remote');

    await remote.pushUpdates(
      fileId,
      Y.encodeStateAsUpdate(doc, remoteSnapshot.stateVector),
      {
        baseRevision: remoteSnapshot.revision,
        localStateVector: Y.encodeStateVector(doc),
      },
    );

    const session = await expectQuickLocalResult(
      repository.openSession(fileId),
    );
    await waitForCondition(
      () => readNoteText(session.encodeUpdate()) === 'base remote',
    );

    session.ydoc.doc.getText('content').insert(4, ' local');
    await expectQuickLocalResult(session.save());

    expect(readNoteText((await repository.loadDocument(fileId)).update)).toBe(
      'base local remote',
    );

    await repository.flushPending();
    await repository.refresh();
    await session.pull();

    const mergedText = readNoteText(
      (await repository.loadDocument(fileId)).update,
    );
    expect(mergedText).toContain('base');
    expect(mergedText).toContain('remote');
    expect(mergedText).toContain('local');
    expect(readNoteText(session.encodeUpdate())).toBe(mergedText);

    await session.close();
  });

  it('creates files without waiting for a blocked remote refresh', async () => {
    const remote = new MemoryRemoteRepository();
    const existingId = await remote.createFile(
      'Existing remote',
      'mcanvas',
      null,
    );
    const initialNote = createNoteState('remote baseline');

    await remote.pushUpdates(existingId, initialNote.update, {
      baseRevision: null,
      localStateVector: initialNote.stateVector,
    });

    const cache = new LocalRepository(
      'repositories/create-during-refresh-test',
    );
    const repository = new CachedRepository(
      remote,
      cache,
      'repositories/create-during-refresh-test/outbox.json',
    );

    await repository.initialize();

    const remoteRefresh = createDeferred();
    const reachedRemoteFileLoad = createDeferred();
    remote.blockFileLoads(remoteRefresh.promise, reachedRemoteFileLoad.resolve);

    const refreshPromise = repository.refresh();
    await reachedRemoteFileLoad.promise;

    const createdId = await expectQuickLocalResult(
      repository.createFile('Fast local note', 'mcanvas', null),
    );

    expect((await repository.getNode(createdId))?.name).toBe('Fast local note');

    remoteRefresh.resolve();
    await refreshPromise;

    expect((await repository.getNode(createdId))?.name).toBe('Fast local note');
  });

  it('keeps same-node note pushes queued when cache changes during remote flush', async () => {
    const remote = new MemoryRemoteRepository();
    const fileId = await remote.createFile('Remote note', 'mcanvas', null);
    const initialNote = createNoteState('base');

    await remote.pushUpdates(fileId, initialNote.update, {
      baseRevision: null,
      localStateVector: initialNote.stateVector,
    });

    const cache = new LocalRepository(
      'repositories/same-node-during-flush-test',
    );
    const repository = new CachedRepository(
      remote,
      cache,
      'repositories/same-node-during-flush-test/outbox.json',
    );

    await repository.initialize();

    const firstSnapshot = await repository.loadDocument(fileId);
    const firstDoc = new Y.Doc();
    if (firstSnapshot.update) {
      Y.applyUpdate(firstDoc, firstSnapshot.update);
    }
    firstDoc.getText('content').insert(4, ' one');

    await repository.pushUpdates(
      fileId,
      Y.encodeStateAsUpdate(firstDoc, firstSnapshot.stateVector),
      {
        baseRevision: firstSnapshot.revision,
        localStateVector: Y.encodeStateVector(firstDoc),
      },
    );

    const remoteSave = createDeferred();
    const reachedRemoteSave = createDeferred();
    remote.blockFileSaves(remoteSave.promise, reachedRemoteSave.resolve);

    const flushPromise = repository.flushPending();
    await reachedRemoteSave.promise;

    const secondSnapshot = await repository.loadDocument(fileId);
    const secondDoc = new Y.Doc();
    if (secondSnapshot.update) {
      Y.applyUpdate(secondDoc, secondSnapshot.update);
    }
    secondDoc.getText('content').insert(8, ' two');

    await repository.pushUpdates(
      fileId,
      Y.encodeStateAsUpdate(secondDoc, secondSnapshot.stateVector),
      {
        baseRevision: secondSnapshot.revision,
        localStateVector: Y.encodeStateVector(secondDoc),
      },
    );

    remoteSave.resolve();
    await flushPromise;

    expect(readNoteText((await remote.loadDocument(fileId)).update)).toBe(
      'base one',
    );
    expect(readNoteText((await repository.loadDocument(fileId)).update)).toBe(
      'base one two',
    );
    expect(repository.getRuntimeStatus().pendingRemoteWrites).toBe(1);

    await repository.flushPending();

    expect(readNoteText((await remote.loadDocument(fileId)).update)).toBe(
      'base one two',
    );
    expect(repository.getRuntimeStatus().pendingRemoteWrites).toBe(0);
  });

  it('continues flushing unrelated tail ops appended during remote flush', async () => {
    const remote = new MemoryRemoteRepository();
    const fileId = await remote.createFile('Remote note', 'mcanvas', null);
    const initialNote = createNoteState('base');

    await remote.pushUpdates(fileId, initialNote.update, {
      baseRevision: null,
      localStateVector: initialNote.stateVector,
    });

    const cache = new LocalRepository('repositories/tail-during-flush-test');
    const repository = new CachedRepository(
      remote,
      cache,
      'repositories/tail-during-flush-test/outbox.json',
    );

    await repository.initialize();

    const snapshot = await repository.loadDocument(fileId);
    const doc = new Y.Doc();
    if (snapshot.update) {
      Y.applyUpdate(doc, snapshot.update);
    }
    doc.getText('content').insert(4, ' one');

    await repository.pushUpdates(
      fileId,
      Y.encodeStateAsUpdate(doc, snapshot.stateVector),
      {
        baseRevision: snapshot.revision,
        localStateVector: Y.encodeStateVector(doc),
      },
    );

    const remoteSave = createDeferred();
    const reachedRemoteSave = createDeferred();
    remote.blockFileSaves(remoteSave.promise, reachedRemoteSave.resolve);

    const flushPromise = repository.flushPending();
    await reachedRemoteSave.promise;

    const createdId = await repository.createFile('Tail note', 'mcanvas', null);

    remoteSave.resolve();
    await flushPromise;

    const remoteSnapshot = await remote.exportSnapshot();
    expect(readNoteText(remoteSnapshot.notes[fileId] ?? null)).toBe('base one');
    expect(remoteSnapshot.manifest.nodes[createdId]?.name).toBe('Tail note');
    expect(repository.getRuntimeStatus().pendingRemoteWrites).toBe(0);
    expect(
      getRepositoryTestStorage().readText(
        'repositories/tail-during-flush-test/outbox.json',
      ),
    ).toBe('[]');
  });

  it('writes pending note changes to the outbox on session close without flushing the remote', async () => {
    const remote = new MemoryRemoteRepository();
    const fileId = await remote.createFile('Remote note', 'mcanvas', null);
    const initialNote = createNoteState('remote baseline');

    await remote.pushUpdates(fileId, initialNote.update, {
      baseRevision: null,
      localStateVector: initialNote.stateVector,
    });

    const cache = new LocalRepository('repositories/close-outbox-test');
    const repository = new CachedRepository(
      remote,
      cache,
      'repositories/close-outbox-test/outbox.json',
    );

    await repository.initialize();

    const session = await repository.openSession(fileId);
    session.ydoc.doc.getText('content').insert(15, ' plus local close edit');

    expect(session.hasUnsyncedChanges()).toBe(true);

    await session.close();

    expect(readNoteText((await repository.loadDocument(fileId)).update)).toBe(
      'remote baseline plus local close edit',
    );
    expect(repository.getRuntimeStatus().pendingRemoteWrites).toBe(1);

    const storage = getRepositoryTestStorage();
    expect(
      JSON.parse(
        storage.readText('repositories/close-outbox-test/outbox.json') ?? '[]',
      ),
    ).toEqual([expect.objectContaining({ kind: 'push-note', nodeId: fileId })]);

    expect(readNoteText((await remote.loadDocument(fileId)).update)).toBe(
      'remote baseline',
    );
  });

  it('quarantines a corrupt outbox and keeps local cache state during initialize', async () => {
    const remote = new MemoryRemoteRepository();
    const fileId = await remote.createFile('Remote note', 'mcanvas', null);
    const remoteNote = createNoteState('remote version');

    await remote.pushUpdates(fileId, remoteNote.update, {
      baseRevision: null,
      localStateVector: remoteNote.stateVector,
    });

    const cache = new LocalRepository('repositories/corrupt-outbox-test');
    const storage = getRepositoryTestStorage();
    const outboxPath = 'repositories/corrupt-outbox-test/outbox.json';

    await cache.replaceSnapshot(await remote.exportSnapshot());

    const cacheSnapshot = await cache.loadDocument(fileId);
    const doc = new Y.Doc();
    if (cacheSnapshot.update) {
      Y.applyUpdate(doc, cacheSnapshot.update);
    }
    const text = doc.getText('content');
    text.delete(0, text.length);
    text.insert(0, 'local offline version');

    await cache.pushUpdates(
      fileId,
      Y.encodeStateAsUpdate(doc, cacheSnapshot.stateVector),
      {
        baseRevision: cacheSnapshot.revision,
        localStateVector: Y.encodeStateVector(doc),
      },
    );

    await storage.writeTextFile(outboxPath, 'not valid json');

    const repository = new CachedRepository(remote, cache, outboxPath);

    await repository.initialize();

    const backup = (
      await storage.readDir('repositories/corrupt-outbox-test')
    ).find(
      (entry) =>
        entry.name.startsWith('outbox.corrupt.') &&
        entry.name.endsWith('.json'),
    );
    const status = repository.getRuntimeStatus();

    expect(storage.readText(outboxPath)).toBeNull();
    expect(backup).toBeDefined();
    expect(
      storage.readText(
        `repositories/corrupt-outbox-test/${backup?.name ?? ''}`,
      ),
    ).toBe('not valid json');
    expect(readNoteText((await repository.loadDocument(fileId)).update)).toBe(
      'local offline version',
    );
    expect(readNoteText((await remote.loadDocument(fileId)).update)).toBe(
      'remote version',
    );
    expect(status.online).toBe(false);
    expect(status.lastError?.message).toContain('outbox');
    expect(repository.getRuntimeStatus().pendingRemoteWrites).toBe(0);
  });

  it('serializes concurrent initialize calls that target the same outbox', async () => {
    const createRemote = () =>
      new GitHubRepository({
        owner: 'myelin',
        repo: 'cached-concurrent-init',
        branch: 'main',
        credentialId: 'test-credential',
      });

    const seedRemote = createRemote();
    const fileId = await seedRemote.createFile('Remote note', 'mcanvas', null);
    const initialNote = createNoteState('remote baseline');

    await seedRemote.pushUpdates(fileId, initialNote.update, {
      baseRevision: null,
      localStateVector: initialNote.stateVector,
    });

    const cacheRoot = 'repositories/concurrent-init-test';
    const outboxPath = `${cacheRoot}/outbox.json`;
    const cacheSeed = new LocalRepository(cacheRoot);
    await cacheSeed.replaceSnapshot(await seedRemote.exportSnapshot());

    const cacheSnapshot = await cacheSeed.loadDocument(fileId);
    const doc = new Y.Doc();
    if (cacheSnapshot.update) {
      Y.applyUpdate(doc, cacheSnapshot.update);
    }
    const text = doc.getText('content');
    text.delete(0, text.length);
    text.insert(0, 'local pending edit');

    await cacheSeed.pushUpdates(
      fileId,
      Y.encodeStateAsUpdate(doc, cacheSnapshot.stateVector),
      {
        baseRevision: cacheSnapshot.revision,
        localStateVector: Y.encodeStateVector(doc),
      },
    );

    const storage = getRepositoryTestStorage();
    await storage.writeTextFile(
      outboxPath,
      JSON.stringify([{ kind: 'push-note', nodeId: fileId }]),
    );

    const first = new CachedRepository(
      createRemote(),
      new LocalRepository(cacheRoot),
      outboxPath,
    );
    const second = new CachedRepository(
      createRemote(),
      new LocalRepository(cacheRoot),
      outboxPath,
    );

    await Promise.all([first.initialize(), second.initialize()]);

    expect(first.getRuntimeStatus().lastError).toBeNull();
    expect(second.getRuntimeStatus().lastError).toBeNull();
    // Init no longer flushes, so the remote is still on baseline and the
    // queued op survives. Flushing explicitly drains the shared outbox.
    expect(
      readNoteText((await createRemote().loadDocument(fileId)).update),
    ).toBe('remote baseline');

    await first.flushPending();

    expect(
      readNoteText((await createRemote().loadDocument(fileId)).update),
    ).toBe('local pending edit');
    expect(storage.readText(outboxPath)).toBe('[]');
  });
});
