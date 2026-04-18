import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
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
      {
        localPeer: {
          peerId: 'test-peer',
          mode: 'owner-device',
        },
      },
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
});
