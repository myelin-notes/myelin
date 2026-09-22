import * as Y from 'yjs';
import type { YjsSyncSnapshot } from '@myelin/editor/sync/types';
import { Logger } from '@myelin/shared/logger';
import { extractStoredNoteLinks } from '../note-link-index';
import {
  computeRevision,
  createDocFromBytes,
  deleteNodeFromManifest,
  getStoredFilePath,
  MANIFEST_PATH,
  setStoredNoteLinks,
  type VFSManifest,
} from '../shared';
import type { VFSFileNode, VFSNodeId } from '../types';
import type { PendingOp } from './outbox';
import { applyCachedManifestUpsert } from './reconcile';

const logger = new Logger('CachedRepository');

/** The changes and manifest produced from one stable outbox and cache capture. */
export interface BatchPlan {
  manifest: VFSManifest;
  manifestChanged: boolean;
  additions: Map<string, Uint8Array>;
  deletions: Set<string>;
  messages: string[];
  resolvedOps: PendingOp[];
  expectedHeadOid: string;
}

/** Remote reads needed to merge a captured batch into a single commit. */
export interface BatchPlanRemote {
  readFileBytes(nodeId: VFSNodeId): Promise<Uint8Array | null>;
  loadDocument(nodeId: VFSNodeId): Promise<YjsSyncSnapshot>;
}

export interface BatchCanvasOperation {
  op: Extract<PendingOp, { kind: 'push-note' }>;
  node: VFSFileNode;
  snapshot: YjsSyncSnapshot;
}

export interface BatchRawOperation {
  op: Extract<PendingOp, { kind: 'push-note' }>;
  node: VFSFileNode;
  bytes: Uint8Array | null;
}

/** State captured by CachedRepository while it owns the local-state mutex. */
export interface BatchPlanInput {
  repositoryKind: string;
  remote: BatchPlanRemote;
  expectedHeadOid: string;
  remoteManifest: VFSManifest;
  cacheManifest: VFSManifest;
  ops: PendingOp[];
  canvasOps: BatchCanvasOperation[];
  rawOps: BatchRawOperation[];
  now?: number;
}

export type BatchPlanResult = BatchPlan | 'abort-to-rest';

async function mapWithConcurrency<T, U>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<U>,
): Promise<U[]> {
  const results: U[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(Math.max(1, limit), items.length) },
    async () => {
      while (true) {
        const index = cursor;
        cursor += 1;
        if (index >= items.length) {
          return;
        }
        results[index] = await fn(items[index]);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

async function hasRawConflict(
  remote: BatchPlanRemote,
  rawOps: readonly BatchRawOperation[],
  repositoryKind: string,
): Promise<boolean> {
  for (const entry of rawOps) {
    if (entry.op.replaceFile || entry.op.baseFileRevision === undefined) {
      continue;
    }
    const remoteBytes = await remote.readFileBytes(entry.op.nodeId);
    const remoteRevision = await computeRevision(remoteBytes);
    if (remoteRevision !== entry.op.baseFileRevision) {
      const localRevision = await computeRevision(entry.bytes);
      if (remoteRevision === localRevision) {
        continue;
      }
      logger.debug('Raw file conflict detected; aborting batch', {
        repositoryKind,
        nodeId: entry.op.nodeId,
        baseFileRevision: entry.op.baseFileRevision,
        remoteRevision,
      });
      return true;
    }
  }
  return false;
}

/**
 * Builds a commit from one consistent cache/outbox capture. `abort-to-rest` preserves the existing
 * per-operation fallback for raw conflicts and missing replacement bytes.
 */
export async function createBatchPlan(
  input: BatchPlanInput,
): Promise<BatchPlanResult> {
  const plan: BatchPlan = {
    manifest: structuredClone(input.remoteManifest),
    manifestChanged: false,
    additions: new Map(),
    deletions: new Set(),
    messages: [],
    resolvedOps: input.ops,
    expectedHeadOid: input.expectedHeadOid,
  };

  for (const op of input.ops) {
    switch (op.kind) {
      case 'upsert-manifest-node':
        applyCachedManifestUpsert(
          plan.manifest,
          input.cacheManifest,
          op.nodeId,
        );
        plan.manifestChanged = true;
        plan.messages.push(`Upsert node ${op.nodeId}`);
        break;
      case 'delete-manifest-node':
        for (const fileId of op.deletedFileIds) {
          const node = plan.manifest.nodes[fileId];
          if (node && node.type === 'file') {
            plan.deletions.add(getStoredFilePath(node));
          }
        }
        deleteNodeFromManifest(plan.manifest, op.nodeId);
        plan.manifestChanged = true;
        plan.messages.push(`Delete node ${op.nodeId}`);
        break;
      case 'sync-custom-colors':
        plan.manifest.colors = structuredClone(input.cacheManifest.colors);
        plan.manifestChanged = true;
        plan.messages.push('Sync custom colors');
        break;
      case 'sync-tag-registry':
        plan.manifest.tagRegistry = [...input.cacheManifest.tagRegistry];
        plan.manifestChanged = true;
        plan.messages.push('Sync tag registry');
        break;
      case 'sync-pen-presets':
        plan.manifest.penPresets = structuredClone(
          input.cacheManifest.penPresets,
        );
        plan.manifestChanged = true;
        plan.messages.push('Sync pen presets');
        break;
      case 'push-note': {
        const node = input.cacheManifest.nodes[op.nodeId];
        if (!node || node.type !== 'file') {
          plan.messages.push(`Skip missing node ${op.nodeId}`);
        }
        break;
      }
    }
  }

  const fileSavedAt = input.now ?? Date.now();

  if (input.rawOps.length > 0) {
    if (
      await hasRawConflict(input.remote, input.rawOps, input.repositoryKind)
    ) {
      return 'abort-to-rest';
    }
    for (const entry of input.rawOps) {
      if (entry.op.replaceFile && !entry.bytes) {
        return 'abort-to-rest';
      }
      plan.additions.set(
        getStoredFilePath(entry.node),
        entry.bytes ?? new Uint8Array(),
      );
      if (entry.op.replaceFile && entry.node.fileType === 'mcanvas') {
        setStoredNoteLinks(
          plan.manifest,
          entry.node.id,
          extractStoredNoteLinks(createDocFromBytes(entry.bytes)),
        );
        plan.messages.push(`Replace note ${entry.node.name}`);
      } else {
        plan.messages.push(
          `Update raw ${entry.node.fileType} ${entry.node.name}`,
        );
      }
      const manifestNode = plan.manifest.nodes[entry.node.id];
      if (manifestNode && manifestNode.type === 'file') {
        manifestNode.modifiedAt = fileSavedAt;
        plan.manifestChanged = true;
      }
    }
  }

  if (input.canvasOps.length > 0) {
    const merged = await mapWithConcurrency(
      input.canvasOps,
      4,
      async (entry) => {
        const remoteSnapshot = await input.remote.loadDocument(entry.op.nodeId);
        const doc = new Y.Doc();
        if (remoteSnapshot.update && remoteSnapshot.update.byteLength > 0) {
          Y.applyUpdate(doc, remoteSnapshot.update);
        }
        if (entry.snapshot.update && entry.snapshot.update.byteLength > 0) {
          Y.applyUpdate(doc, entry.snapshot.update);
        }
        return {
          nodeId: entry.node.id,
          path: getStoredFilePath(entry.node),
          bytes: Y.encodeStateAsUpdate(doc),
          links: extractStoredNoteLinks(doc),
          name: entry.node.name,
        };
      },
    );
    for (const mergedNote of merged) {
      plan.additions.set(mergedNote.path, mergedNote.bytes);
      plan.messages.push(`Update note ${mergedNote.name}`);
      const manifestNode = plan.manifest.nodes[mergedNote.nodeId];
      if (manifestNode && manifestNode.type === 'file') {
        manifestNode.modifiedAt = fileSavedAt;
        setStoredNoteLinks(plan.manifest, mergedNote.nodeId, mergedNote.links);
        plan.manifestChanged = true;
      }
    }
  }

  if (plan.manifestChanged) {
    plan.additions.set(
      MANIFEST_PATH,
      new TextEncoder().encode(JSON.stringify(plan.manifest, null, 2)),
    );
  }

  for (const path of plan.additions.keys()) {
    plan.deletions.delete(path);
  }

  return plan;
}
