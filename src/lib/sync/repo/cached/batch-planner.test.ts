import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createEmptyManifest, getStoredFilePath } from '../shared';
import type { FileType, VFSFileNode } from '../types';
import { type BatchPlanRemote, createBatchPlan } from './batch-planner';

function createFileNode(id: string, fileType: FileType): VFSFileNode {
  return {
    id,
    name: fileType === 'mcanvas' ? 'Note' : 'Clip.mp4',
    type: 'file',
    fileType,
    parentId: null,
    tags: [],
    createdAt: 1,
    modifiedAt: 1,
  };
}

function documentSnapshot(doc: Y.Doc) {
  return {
    update: Y.encodeStateAsUpdate(doc),
    stateVector: Y.encodeStateVector(doc),
    revision: 'revision',
  };
}

describe('createBatchPlan', () => {
  it('merges a canvas update using only its remote read port', async () => {
    const node = createFileNode('note-1', 'mcanvas');
    const remoteManifest = createEmptyManifest();
    remoteManifest.nodes[node.id] = structuredClone(node);
    const cacheManifest = structuredClone(remoteManifest);

    const remoteDoc = new Y.Doc();
    remoteDoc.getMap('remote').set('value', 'remote');
    const localDoc = new Y.Doc();
    localDoc.getMap('local').set('value', 'local');
    const remote: BatchPlanRemote = {
      readFileBytes: vi.fn(),
      loadDocument: vi.fn(async () => documentSnapshot(remoteDoc)),
    };

    const plan = await createBatchPlan({
      repositoryKind: 'test',
      remote,
      expectedHeadOid: 'head-1',
      remoteManifest,
      cacheSnapshot: { manifest: cacheManifest, notes: { [node.id]: null } },
      ops: [{ kind: 'push-note', nodeId: node.id, queueRevision: 'queue-1' }],
      canvasOps: [
        {
          op: {
            kind: 'push-note',
            nodeId: node.id,
            queueRevision: 'queue-1',
          },
          node,
          snapshot: documentSnapshot(localDoc),
        },
      ],
      rawOps: [],
      now: 123,
    });

    expect(plan).not.toBe('abort-to-rest');
    if (plan === 'abort-to-rest') {
      return;
    }

    const mergedBytes = plan.additions.get(getStoredFilePath(node));
    expect(mergedBytes).toBeDefined();
    const merged = new Y.Doc();
    Y.applyUpdate(merged, mergedBytes ?? new Uint8Array());
    expect(merged.getMap('remote').get('value')).toBe('remote');
    expect(merged.getMap('local').get('value')).toBe('local');
    expect(plan.manifest.nodes[node.id]).toMatchObject({ modifiedAt: 123 });
    expect(remote.loadDocument).toHaveBeenCalledWith(node.id);
  });

  it('falls back when a raw file has changed remotely', async () => {
    const node = createFileNode('clip-1', 'mp4');
    const remoteManifest = createEmptyManifest();
    remoteManifest.nodes[node.id] = structuredClone(node);
    const remote: BatchPlanRemote = {
      readFileBytes: vi.fn(async () => new Uint8Array([9])),
      loadDocument: vi.fn(),
    };

    await expect(
      createBatchPlan({
        repositoryKind: 'test',
        remote,
        expectedHeadOid: 'head-1',
        remoteManifest,
        cacheSnapshot: {
          manifest: structuredClone(remoteManifest),
          notes: { [node.id]: new Uint8Array([4]) },
        },
        ops: [
          {
            kind: 'push-note',
            nodeId: node.id,
            baseFileRevision: 'stale-revision',
            queueRevision: 'queue-1',
          },
        ],
        canvasOps: [],
        rawOps: [
          {
            op: {
              kind: 'push-note',
              nodeId: node.id,
              baseFileRevision: 'stale-revision',
              queueRevision: 'queue-1',
            },
            node,
            bytes: new Uint8Array([4]),
          },
        ],
      }),
    ).resolves.toBe('abort-to-rest');
  });
});
