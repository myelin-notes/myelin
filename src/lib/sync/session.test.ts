import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { ElementType } from '@myelin/editor/elements/element-type';
import {
  REPOSITORY_SYNC_ORIGIN,
  YDocManager,
} from '@myelin/editor/ydoc-manager';
import type {
  NativeDocumentSnapshot,
  NativeDocumentTarget,
  NativeDocumentWriteResult,
} from './native-document-target';
import { NoteSession } from './session';

function createSyncTarget(doc = new Y.Doc()) {
  const snapshot = (): NativeDocumentSnapshot => ({
    update: Y.encodeStateAsUpdate(doc),
    stateVector: Y.encodeStateVector(doc),
    revision: 'test',
    generation: 'original',
  });
  const persistDocumentUpdate = vi.fn(
    async (
      _id: string,
      update: Uint8Array,
    ): Promise<NativeDocumentWriteResult> => {
      Y.applyUpdate(doc, update);
      return {
        ...snapshot(),
        accepted: true,
        changed: true,
      };
    },
  );
  const target = {
    nativeRepositoryHandle: 'test',
    loadDocument: async () => snapshot(),
    pullUpdates: async () => snapshot(),
    persistDocumentUpdate,
    flushDocument: vi.fn(async () => {}),
    subscribeDocument: async () => async () => {},
  } satisfies NativeDocumentTarget;
  return { doc, target };
}

describe('NoteSession', () => {
  it('fires local change listeners for edits and ignores repository updates', async () => {
    const native = createSyncTarget();
    const session = await NoteSession.open('note', native.target);
    const listener = vi.fn();
    const unsubscribe = session.subscribeLocalChanges(listener);
    session.ydoc.doc.getMap('test').set('value', 1);
    const remoteDoc = new Y.Doc();
    remoteDoc.getMap('remote').set('value', 2);
    session.applyUpdate(
      Y.encodeStateAsUpdate(remoteDoc),
      REPOSITORY_SYNC_ORIGIN,
    );
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
    session.ydoc.doc.getMap('test').set('value', 3);
    expect(listener).toHaveBeenCalledOnce();
    await session.close();
    remoteDoc.destroy();
    native.doc.destroy();
  });

  it('persists delete-only canvas edits and marks them saved after checkpointing', async () => {
    const ydoc = new YDocManager();
    ydoc.createElementMap(ElementType.PAGE_FRAME, 'frame', {
      offsetX: 0,
      offsetY: 0,
      scaleX: 1,
      scaleY: 1,
      pageWidth: 100,
      pageHeight: 100,
    });
    const native = createSyncTarget();
    Y.applyUpdate(native.doc, ydoc.encodeState());
    const session = await NoteSession.open('note', native.target);
    session.ydoc.removeElementMap(session.ydoc.elements.get(0));
    expect(session.hasUnsyncedChanges()).toBe(true);
    expect(await session.save()).toBe(true);
    const stored = YDocManager.fromUpdate(Y.encodeStateAsUpdate(native.doc));
    expect(stored.elements.length).toBe(0);
    expect(session.hasUnsyncedChanges()).toBe(false);
    expect(native.target.flushDocument).toHaveBeenCalledWith('note');
    expect(await session.save()).toBe(false);
    await session.close();
    stored.doc.destroy();
    ydoc.doc.destroy();
    native.doc.destroy();
  });

  it('waits for persistence before save and close checkpoint without sending edits twice', async () => {
    const native = createSyncTarget();
    const persist =
      native.target.persistDocumentUpdate.getMockImplementation()!;
    let resolve!: () => void;
    const gate = new Promise<void>((done) => {
      resolve = done;
    });
    native.target.persistDocumentUpdate.mockImplementationOnce(
      async (...args) => {
        await gate;
        return persist(...args);
      },
    );
    const session = await NoteSession.open('note', native.target);
    let saving!: () => void;
    const started = new Promise<void>((done) => {
      saving = done;
    });
    session.subscribeStatus((status) => {
      if (status.phase === 'pushing') {
        saving();
      }
    });
    session.ydoc.doc.getText('content').insert(0, 'queued');
    const save = session.save();
    const close = session.close();
    await started;
    expect(native.target.flushDocument).not.toHaveBeenCalled();
    resolve();
    await Promise.all([save, close]);
    expect(native.doc.getText('content').toString()).toBe('queued');
    expect(native.target.persistDocumentUpdate).toHaveBeenCalledOnce();
    expect(session.hasUnsyncedChanges()).toBe(false);
    expect(native.target.flushDocument).toHaveBeenCalledTimes(2);
    native.doc.destroy();
  });
});
