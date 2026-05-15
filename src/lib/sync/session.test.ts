import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { ElementType } from '@/pages/canvas/elements/element-type';
import {
  REPOSITORY_SYNC_ORIGIN,
  YDocManager,
} from '@/pages/canvas/ydoc-manager';
import { NoteSession } from './session';
import type {
  VFSNodeId,
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
      _nodeId: VFSNodeId,
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
  it('fires for local edits and ignores repository-applied updates', () => {
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
      ydoc.doc.getMap('test').set('value', 1);
    });

    const remoteDoc = new Y.Doc();
    remoteDoc.getMap('test').set('value', 2);
    session.applyUpdate(
      Y.encodeStateAsUpdate(remoteDoc),
      REPOSITORY_SYNC_ORIGIN,
    );

    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
  });

  it('treats raw Y.Doc edits as unsynced changes and saves them', async () => {
    const ydoc = new YDocManager();
    const pushUpdates = vi.fn<
      (
        nodeId: VFSNodeId,
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

    session.ydoc.doc.getText('content').insert(0, 'hello');

    expect(session.hasUnsyncedChanges()).toBe(true);

    await session.save();

    expect(pushUpdates).toHaveBeenCalledTimes(1);
    expect(session.hasUnsyncedChanges()).toBe(false);
  });

  it('does not enter pushing phase when saving with no unsynced changes', async () => {
    const ydoc = new YDocManager();
    const pushUpdates = vi.fn<
      (
        nodeId: VFSNodeId,
        update: Uint8Array,
        options: YjsSyncPushOptions,
      ) => Promise<YjsSyncPushResult>
    >();

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
    const phases: string[] = [];
    const unsubscribe = session.subscribeStatus((status) => {
      phases.push(status.phase);
    });

    await session.save();

    expect(pushUpdates).not.toHaveBeenCalled();
    expect(phases).toEqual(['idle']);

    unsubscribe();
  });

  it('does not mark pulled repository updates as local changes', async () => {
    const ydoc = new YDocManager();
    const remoteDoc = new Y.Doc();
    remoteDoc.getText('content').insert(0, 'from remote');
    const pullUpdates = vi.fn(
      async (): Promise<YjsSyncSnapshot> => ({
        update: Y.encodeStateAsUpdate(remoteDoc),
        stateVector: Y.encodeStateVector(remoteDoc),
        revision: 'rev-2',
      }),
    );

    const session = new NoteSession(
      'note-1',
      ydoc,
      {
        ...createSyncTarget(),
        pullUpdates,
      },
      null,
      ydoc.encodeStateVector(),
    );
    const listener = vi.fn();
    const unsubscribe = session.subscribeLocalChanges(listener);

    await session.pull();

    expect(listener).not.toHaveBeenCalled();
    expect(session.hasUnsyncedChanges()).toBe(false);

    unsubscribe();
  });

  it('treats delete-only canvas changes as unsynced and pushes them', async () => {
    const ydoc = new YDocManager();
    const yMap = ydoc.createElementMap(ElementType.PAGE_FRAME, 'frame-uuid', {
      offsetX: 0,
      offsetY: 0,
      scaleX: 1,
      scaleY: 1,
      pageWidth: 100,
      pageHeight: 100,
    });

    const pushUpdates = vi.fn<
      (
        nodeId: VFSNodeId,
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

    await session.save();

    expect(pushUpdates).toHaveBeenCalledTimes(1);
    expect(session.hasUnsyncedChanges()).toBe(false);
  });

  it('serializes save and close without pushing twice', async () => {
    const ydoc = new YDocManager();
    let resolvePush: (() => void) | undefined;
    let lastStatusPhase: string | null = null;
    const pushUpdates = vi.fn<
      (
        nodeId: VFSNodeId,
        update: Uint8Array,
        options: YjsSyncPushOptions,
      ) => Promise<YjsSyncPushResult>
    >(
      () =>
        new Promise<YjsSyncPushResult>((resolve) => {
          resolvePush = () =>
            resolve({
              accepted: true,
              remoteUpdate: null,
              update: ydoc.encodeState(),
              stateVector: ydoc.encodeStateVector(),
              revision: 'rev-1',
            });
        }),
    );

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
    const unsubscribeStatus = session.subscribeStatus((status) => {
      lastStatusPhase = status.phase;
    });

    session.ydoc.doc.getText('content').insert(0, 'queued');

    const savePromise = session.save();
    const closePromise = session.close();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(pushUpdates).toHaveBeenCalledTimes(1);

    resolvePush?.();
    await Promise.all([savePromise, closePromise]);

    expect(pushUpdates).toHaveBeenCalledTimes(1);
    expect(lastStatusPhase).toBe('closed');

    unsubscribeStatus();
  });
});
