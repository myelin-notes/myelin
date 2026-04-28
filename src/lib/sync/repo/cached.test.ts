import { beforeEach, describe, expect, it } from 'vitest';
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
  type VFSManifest,
} from './shared';
import type { RepositoryCapabilities, VFSFileNode } from './types';

class MemoryRemoteRepository extends BaseRepository {
  public readonly kind = 'memory-remote';
  public readonly capabilities: RepositoryCapabilities = {
    polling: false,
    liveSync: false,
  };

  private manifest: VFSManifest = createEmptyManifest();
  private manifestRevision: string | null = null;
  private readonly notes = new Map<string, Uint8Array>();
  private noteRevision = 0;
  private manifestVersion = 0;

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

  protected async loadFileBytes(nodeId: string): Promise<{
    bytes: Uint8Array | null;
    revision: string | null;
  }> {
    const bytes = this.notes.get(nodeId) ?? null;
    return {
      bytes: bytes ? new Uint8Array(bytes) : null,
      revision: bytes ? await computeRevision(bytes) : null,
    };
  }

  protected async saveFileBytes(
    nodeId: string,
    bytes: Uint8Array,
    _revision: string | null,
    _message: string,
  ): Promise<string> {
    this.notes.set(nodeId, new Uint8Array(bytes));
    return `note-${++this.noteRevision}`;
  }

  protected async deleteFileBytes(nodeId: string): Promise<void> {
    this.notes.delete(nodeId);
  }
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

  it('pushes preexisting cache contents to an empty remote on initialize', async () => {
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

    const remoteSnapshot = await remote.exportSnapshot();
    expect(remoteSnapshot.manifest.nodes[fileId]?.type).toBe('file');
    expect(readNoteText(remoteSnapshot.notes[fileId] ?? null)).toBe(
      'pushed from cache bootstrap',
    );
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
      {
        kind: 'delete-manifest-node',
        nodeId: fileId,
        deletedFileIds: [fileId],
      },
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

  it('pulls newer remote note state when opening a session', async () => {
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

    const session = await repository.openSession(fileId);

    expect(readNoteText(session.encodeUpdate())).toBe('opened latest remote');
    expect(readNoteText((await repository.loadDocument(fileId)).update)).toBe(
      'opened latest remote',
    );

    await session.close();
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
    expect(storage.readText('repositories/close-outbox-test/outbox.json')).toBe(
      JSON.stringify([{ kind: 'push-note', nodeId: fileId }]),
    );

    expect(readNoteText((await remote.loadDocument(fileId)).update)).toBe(
      'remote baseline',
    );
  });

  it('recovers from a corrupted outbox file during initialize', async () => {
    const remote = new MemoryRemoteRepository();
    const cache = new LocalRepository('repositories/corrupt-outbox-test');
    const storage = getRepositoryTestStorage();

    await storage.writeTextFile(
      'repositories/corrupt-outbox-test/outbox.json',
      'not valid json',
    );

    const repository = new CachedRepository(
      remote,
      cache,
      'repositories/corrupt-outbox-test/outbox.json',
    );

    await repository.initialize();

    expect(
      storage.readText('repositories/corrupt-outbox-test/outbox.json'),
    ).toBe('[]');
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
    expect(
      readNoteText((await createRemote().loadDocument(fileId)).update),
    ).toBe('local pending edit');
    expect(storage.readText(outboxPath)).toBe('[]');
  });
});
