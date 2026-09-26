import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import {
  computeRevision,
  createEmptyManifest,
  getStoredFilePath,
} from '../shared';
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
    node.modifiedAt = 123;
    cacheManifest.nodes[node.id] = structuredClone(node);

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
      cacheManifest,
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
        cacheManifest: structuredClone(remoteManifest),
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

  it('recognizes a raw file already applied by an ambiguous commit', async () => {
    const node = createFileNode('clip-applied', 'mp4');
    const remoteManifest = createEmptyManifest();
    remoteManifest.nodes[node.id] = structuredClone(node);
    const localBytes = new Uint8Array([4, 5, 6]);
    const remote: BatchPlanRemote = {
      readFileBytes: vi.fn(async () => new Uint8Array(localBytes)),
      loadDocument: vi.fn(),
    };
    const op = {
      kind: 'push-note' as const,
      nodeId: node.id,
      baseFileRevision: await computeRevision(new Uint8Array([1, 2, 3])),
      queueRevision: 'queue-applied',
    };

    const plan = await createBatchPlan({
      repositoryKind: 'test',
      remote,
      expectedHeadOid: 'head-2',
      remoteManifest,
      cacheManifest: structuredClone(remoteManifest),
      ops: [op],
      canvasOps: [],
      rawOps: [{ op, node, bytes: localBytes }],
    });

    expect(plan).not.toBe('abort-to-rest');
  });
});
