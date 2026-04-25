import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { ElementType } from '@/pages/canvas/elements/element-type';
import { YDocManager } from '@/pages/canvas/ydoc-manager';
import { NoteSession } from './session';
import type {
  YjsSyncPushOptions,
  YjsSyncPushResult,
  YjsSyncSnapshot,
} from './types';

function createEmptySnapshot(doc: Y.Doc = new Y.Doc()): YjsSyncSnapshot {
  return {
    update: null,
    stateVector: Y.encodeStateVector(doc),
    revision: null,
  };
}

function createSyncTarget() {
  return {
    loadDocument: async (): Promise<YjsSyncSnapshot> => createEmptySnapshot(),
    pullUpdates: async (): Promise<YjsSyncSnapshot> => createEmptySnapshot(),
    pushUpdates: async (
      _nodeId: string,
      _update: Uint8Array,
      _options: YjsSyncPushOptions,
    ): Promise<YjsSyncPushResult> => ({
      accepted: true,
      remoteUpdate: null,
      ...createEmptySnapshot(),
    }),
  };
}

describe('NoteSession local change listeners', () => {
  it('fires for local edits and ignores externally applied updates', () => {
    const ydoc = new YDocManager();
    const session = new NoteSession(
      'note-1',
      ydoc,
      createSyncTarget(),
      null,
      ydoc.encodeStateVector(),
    );
    const listener = vi.fn();
    const unsubscribe = session.subscribeLocalChanges(listener);

    ydoc.transact(() => {
      ydoc.meta.set('nextIndex', 1);
    });

    const remoteDoc = new Y.Doc();
    remoteDoc.getMap('meta').set('nextIndex', 2);
    session.applyUpdate(Y.encodeStateAsUpdate(remoteDoc));

    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
  });

  it('treats delete-only canvas changes as unsynced and pushes them', async () => {
    const ydoc = new YDocManager();
    const yMap = ydoc.createElementMap(ElementType.PAGE_FRAME, 0, {
      offsetX: 0,
      offsetY: 0,
      scaleX: 1,
      scaleY: 1,
      pageWidth: 100,
      pageHeight: 100,
    });

    const pushUpdates = vi.fn<
      (
        nodeId: string,
        update: Uint8Array,
        options: YjsSyncPushOptions,
      ) => Promise<YjsSyncPushResult>
    >(async (_nodeId, _update, _options) => ({
      accepted: true,
      remoteUpdate: null,
      update: ydoc.encodeState(),
      stateVector: ydoc.encodeStateVector(),
      revision: 'rev-1',
    }));

    const session = new NoteSession(
      'note-1',
      ydoc,
      {
        ...createSyncTarget(),
        pushUpdates,
      },
      null,
      ydoc.encodeStateVector(),
    );

    ydoc.removeElementMap(yMap);

    expect(session.hasUnsyncedChanges()).toBe(true);

    await session.push();

    expect(pushUpdates).toHaveBeenCalledTimes(1);
    expect(session.hasUnsyncedChanges()).toBe(false);
  });
});
