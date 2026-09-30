import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { noopTransport } from '@myelin/editor/sync/live/transport';
import type { YjsSyncPushResult } from '@myelin/editor/sync/types';
import { saveSessionAndCreateVersion } from '@/pages/canvas/hooks/session-version-history';
import type {
  NativeDocumentChange,
  NativeDocumentSnapshot,
  NativeDocumentTarget,
} from './native-document-target';
import { NoteSession } from './session';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function nativeTarget() {
  const doc = new Y.Doc();
  let listener: ((change: NativeDocumentChange) => void) | undefined;
  let generation = 'original';
  const snapshot = (vector?: Uint8Array | null): NativeDocumentSnapshot => ({
    update: Y.encodeStateAsUpdate(doc, vector ?? undefined),
    stateVector: Y.encodeStateVector(doc),
    revision: 'native',
    generation,
  });
  const persist = vi.fn(
    async (
      _id: string,
      update: Uint8Array,
      expected?: string,
      _sourceSession?: string,
    ): Promise<YjsSyncPushResult> => {
      if (expected && expected !== generation) {
        throw new Error('Native document replaced');
      }
      Y.applyUpdate(doc, update);
      return {
        ...snapshot(),
        accepted: true,
        changed: false,
        remoteUpdate: null,
      };
    },
  );
  const target: NativeDocumentTarget = {
    nativeRepositoryHandle: 'native-handle',
    loadDocument: async () => snapshot(),
    pullUpdates: async (_id, vector) => snapshot(vector),
    pushUpdates: (id, update) => persist(id, update),
    persistDocumentUpdate: persist,
    flushDocument: vi.fn(async () => {}),
    subscribeDocument: vi.fn(async (_id, callback, _sessionId) => {
      listener = callback;
      return async () => {
        listener = undefined;
      };
    }),
  };
  return {
    doc,
    target,
    persist,
    emit: (change: NativeDocumentChange) => listener?.(change),
    replace: () => {
      generation = 'replacement';
    },
  };
}

describe('native editor sessions', () => {
  it('renders edits before acknowledgement, coalesces queued deltas, and keeps history epochs separate', async () => {
    const native = nativeTarget();
    const gate = deferred();
    const persist = native.persist.getMockImplementation()!;
    native.persist.mockImplementationOnce(async (...args) => {
      await gate.promise;
      return persist(...args);
    });
    const session = await NoteSession.open('note', native.target);
    const send = vi.fn(async (_bytes: Uint8Array) => {});
    const transport = {
      ...noopTransport,
      connected: true,
      send,
      bindRepository: vi.fn(),
    };
    session.setTransport(transport);
    session.ydoc.doc.getText('content').insert(0, 'a');
    session.ydoc.doc.getText('content').insert(1, 'b');
    session.ydoc.doc.getText('content').insert(2, 'c');
    expect(session.ydoc.doc.getText('content').toString()).toBe('abc');
    expect(native.doc.getText('content').toString()).toBe('');
    expect(native.persist).toHaveBeenCalledTimes(1);
    gate.resolve();
    await vi.waitFor(() =>
      expect(native.doc.getText('content').toString()).toBe('abc'),
    );
    expect(native.persist).toHaveBeenCalledTimes(2);
    const sessionId = vi.mocked(native.target.subscribeDocument).mock
      .calls[0][2];
    expect(sessionId).toBeTruthy();
    expect(
      native.persist.mock.calls.every((call) => call[3] === sessionId),
    ).toBe(true);
    expect(
      native.persist.mock.calls.every((call) => call[2] === 'original'),
    ).toBe(true);
    expect(transport.bindRepository).toHaveBeenCalledWith('native-handle');
    expect(send.mock.calls.some(([bytes]) => bytes[0] === 1)).toBe(false);
    const versions = { createFileVersionIfDue: vi.fn(async () => null) };
    expect(await saveSessionAndCreateVersion(session, versions)).toBe(true);
    expect(versions.createFileVersionIfDue).toHaveBeenCalledOnce();
    expect(await saveSessionAndCreateVersion(session, versions)).toBe(false);
    expect(versions.createFileVersionIfDue).toHaveBeenCalledOnce();
    await session.close();
    native.doc.destroy();
  });

  it('retains failed deltas for retry and does not echo incoming peer/cloud updates', async () => {
    const native = nativeTarget();
    const session = await NoteSession.open('note', native.target);
    native.persist.mockRejectedValueOnce(new Error('disk unavailable'));
    let lastError: Error | null = null;
    session.subscribeStatus((status) => {
      lastError = status.lastError;
    });
    session.ydoc.doc.getText('content').insert(0, 'first');
    await vi.waitFor(() => expect(lastError?.message).toBe('disk unavailable'));
    session.ydoc.doc.getText('content').insert(5, ' second');
    await vi.waitFor(() =>
      expect(native.doc.getText('content').toString()).toBe('first second'),
    );
    await session.save();
    const remote = new Y.Doc();
    remote.getText('remote').insert(0, 'peer text');
    const update = Y.encodeStateAsUpdate(remote);
    const calls = native.persist.mock.calls.length;
    native.emit({
      update,
      origin: 'peer',
      generation: 'original',
      replacement: false,
    });
    native.emit({
      update,
      origin: 'repository',
      generation: 'original',
      replacement: false,
    });
    expect(session.ydoc.doc.getText('remote').toString()).toBe('peer text');
    expect(native.persist).toHaveBeenCalledTimes(calls);
    expect(await session.save()).toBe(false);
    await session.close();
    remote.destroy();
    native.doc.destroy();
  });

  it('catches updates and replacements between initial load and subscription', async () => {
    const native = nativeTarget();
    const subscribe = native.target.subscribeDocument;
    native.target.subscribeDocument = async (...args) => {
      const off = await subscribe(...args);
      native.doc.getText('content').insert(0, 'gap update');
      return off;
    };
    const session = await NoteSession.open('note', native.target);
    expect(session.ydoc.doc.getText('content').toString()).toBe('gap update');
    await session.close();
    native.target.subscribeDocument = async (...args) => {
      const off = await subscribe(...args);
      native.replace();
      return off;
    };
    const replaced = await NoteSession.open('note', native.target);
    expect(replaced.documentReplaced).toBe(true);
    await replaced.close();
    native.doc.destroy();
  });

  it('invalidates replaced sessions and prevents old edits from being saved on close', async () => {
    const native = nativeTarget();
    const session = await NoteSession.open('note', native.target);
    const replaced = vi.fn();
    session.subscribeReplacement(replaced);
    native.replace();
    native.emit({
      update: null,
      origin: 'local',
      generation: 'replacement',
      replacement: true,
    });
    session.ydoc.doc.getText('content').insert(0, 'stale editor');
    expect(replaced).toHaveBeenCalledOnce();
    expect(session.documentReplaced).toBe(true);
    expect(await session.save()).toBe(false);
    await session.close();
    expect(native.persist).not.toHaveBeenCalled();
    expect(native.target.flushDocument).not.toHaveBeenCalled();
    native.doc.destroy();
  });
});
