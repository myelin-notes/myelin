import * as Y from 'yjs';
import {
  BaseDirectory,
  exists,
  mkdir,
  readTextFile,
  writeTextFile,
} from '@tauri-apps/plugin-fs';
import { Logger } from '@/lib/logger';
import { summarizeNoteBytes } from '@/lib/note-state-summary';
import { NoteSession } from '../session';
import type {
  YjsSyncPushOptions,
  YjsSyncPushResult,
  YjsSyncSnapshot,
  YjsSyncTarget,
} from '../types';
import type { BaseRepository } from './base';
import type {
  RepositoryLifecycle,
  RepositoryRuntimeStatus,
  RepositoryStatusSource,
} from './config';
import type { LocalRepository } from './local';
import {
  addChild,
  computeRevision,
  createFileNode,
  createNodeId,
  deleteNodeFromManifest,
  getUniqueFileName,
  type RepositorySnapshot,
  type VFSManifest,
} from './shared';
import type {
  FileType,
  Repository,
  RepositoryCapabilities,
  RepositoryStats,
  RepositoryTag,
  VFSFileNode,
  VFSFolderNode,
  VFSNode,
} from './types';

type PendingOp =
  | {
      kind: 'upsert-manifest-node';
      nodeId: string;
      queueRevision?: string;
    }
  | {
      kind: 'delete-manifest-node';
      nodeId: string;
      deletedFileIds: string[];
      queueRevision?: string;
    }
  | {
      kind: 'push-note';
      nodeId: string;
      baseFileRevision?: string | null;
      queueRevision?: string;
    }
  | { kind: 'sync-custom-colors'; queueRevision?: string };

interface DeletedSubtree {
  nodeIds: string[];
  fileIds: string[];
}

const BACKGROUND_SYNC_INTERVAL_MS = 15_000;
const logger = new Logger('CachedRepository');
interface RepositoryOperationLockState {
  active: boolean;
  waiters: Array<() => void>;
}

const repositoryOperationLocks = new Map<
  string,
  RepositoryOperationLockState
>();

async function withRepositoryOperationLock<T>(
  key: string,
  operation: () => Promise<T>,
): Promise<T> {
  let state = repositoryOperationLocks.get(key);
  if (!state) {
    state = {
      active: false,
      waiters: [],
    };
    repositoryOperationLocks.set(key, state);
  }

  if (state.active) {
    await new Promise<void>((resolve) => {
      state.waiters.push(resolve);
    });
  }

  state.active = true;

  try {
    return await operation();
  } finally {
    const next = state.waiters.shift();
    if (next) {
      next();
    } else {
      state.active = false;
      repositoryOperationLocks.delete(key);
    }
  }
}

function getParentPath(path: string): string {
  const normalized = path.replace(/\/+/g, '/').replace(/\/$/, '');
  const separatorIndex = normalized.lastIndexOf('/');
  return separatorIndex === -1 ? '' : normalized.slice(0, separatorIndex);
}

function isSnapshotEmpty(snapshot: RepositorySnapshot): boolean {
  return (
    snapshot.manifest.children.length === 0 &&
    Object.keys(snapshot.manifest.nodes).length === 0
  );
}

function detachNodeFromAllContainers(
  manifest: VFSManifest,
  nodeId: string,
): void {
  manifest.children = manifest.children.filter((id) => id !== nodeId);
  for (const current of Object.values(manifest.nodes)) {
    if (current.type === 'folder') {
      current.children = current.children.filter((id) => id !== nodeId);
    }
  }
}

function ensureNodePath(
  remoteManifest: VFSManifest,
  cacheManifest: VFSManifest,
  nodeId: string,
): void {
  const cacheNode = cacheManifest.nodes[nodeId];
  if (!cacheNode) {
    return;
  }

  if (cacheNode.parentId !== null) {
    ensureNodePath(remoteManifest, cacheManifest, cacheNode.parentId);
  }

  remoteManifest.nodes[nodeId] = structuredClone(cacheNode);
}

function restoreNodePlacement(
  remoteManifest: VFSManifest,
  cacheManifest: VFSManifest,
  nodeId: string,
): void {
  const cacheNode = cacheManifest.nodes[nodeId];
  if (!cacheNode) {
    return;
  }

  if (cacheNode.parentId === null) {
    remoteManifest.children = [...cacheManifest.children];
    return;
  }

  const cacheParent = cacheManifest.nodes[cacheNode.parentId];
  if (cacheParent?.type === 'folder') {
    remoteManifest.nodes[cacheParent.id] = structuredClone(cacheParent);
  }
}

function applyManifestUpsert(
  remoteManifest: VFSManifest,
  cacheManifest: VFSManifest,
  nodeId: string,
): void {
  if (!cacheManifest.nodes[nodeId]) {
    return;
  }

  ensureNodePath(remoteManifest, cacheManifest, nodeId);
  detachNodeFromAllContainers(remoteManifest, nodeId);
  restoreNodePlacement(remoteManifest, cacheManifest, nodeId);
}

function getExistingParentId(
  manifest: VFSManifest,
  parentId: string | null,
): string | null {
  if (parentId === null) {
    return null;
  }
  return manifest.nodes[parentId]?.type === 'folder' ? parentId : null;
}

function getConflictedFileName(name: string, timestamp: Date): string {
  const timestampLabel = [
    timestamp.getFullYear(),
    String(timestamp.getMonth() + 1).padStart(2, '0'),
    String(timestamp.getDate()).padStart(2, '0'),
    String(timestamp.getHours()).padStart(2, '0'),
    String(timestamp.getMinutes()).padStart(2, '0'),
  ].join('');
  const dotIndex = name.lastIndexOf('.');
  const suffix = ` (Conflicted copy ${timestampLabel})`;

  if (dotIndex <= 0 || dotIndex === name.length - 1) {
    return `${name}${suffix}`;
  }

  return `${name.slice(0, dotIndex)}${suffix}${name.slice(dotIndex)}`;
}

function touchPendingOp(op: PendingOp): void {
  op.queueRevision = createNodeId();
}

function withQueueRevision<T extends PendingOp>(op: T): T {
  touchPendingOp(op);
  return op;
}

function enqueueUpsertManifestNode(ops: PendingOp[], nodeId: string): void {
  const alreadyDeleted = ops.some(
    (op) => op.kind === 'delete-manifest-node' && op.nodeId === nodeId,
  );
  if (alreadyDeleted) {
    return;
  }

  const existing = ops.find(
    (op) => op.kind === 'upsert-manifest-node' && op.nodeId === nodeId,
  );
  if (existing) {
    touchPendingOp(existing);
    return;
  }

  ops.push(withQueueRevision({ kind: 'upsert-manifest-node', nodeId }));
}

function enqueuePushNote(
  ops: PendingOp[],
  nodeId: string,
  baseFileRevision?: string | null,
): void {
  const alreadyDeleted = ops.some(
    (op) =>
      op.kind === 'delete-manifest-node' && op.deletedFileIds.includes(nodeId),
  );
  if (alreadyDeleted) {
    return;
  }

  const existing = ops.find(
    (op) => op.kind === 'push-note' && op.nodeId === nodeId,
  );
  if (existing) {
    touchPendingOp(existing);
    return;
  }

  ops.push(
    withQueueRevision({
      kind: 'push-note',
      nodeId,
      ...(baseFileRevision !== undefined ? { baseFileRevision } : {}),
    }),
  );
}

function enqueueDeleteManifestNode(
  ops: PendingOp[],
  nodeId: string,
  deleted: DeletedSubtree,
): void {
  const deletedNodeIds = new Set(deleted.nodeIds);
  const deletedFileIds = new Set(deleted.fileIds);
  const existingDelete = ops.find(
    (op): op is Extract<PendingOp, { kind: 'delete-manifest-node' }> =>
      op.kind === 'delete-manifest-node' && op.nodeId === nodeId,
  );

  const filtered = ops.filter((op) => {
    switch (op.kind) {
      case 'upsert-manifest-node':
        return !deletedNodeIds.has(op.nodeId);
      case 'delete-manifest-node':
        return !deletedNodeIds.has(op.nodeId);
      case 'push-note':
        return !deletedFileIds.has(op.nodeId);
      default:
        return true;
    }
  });

  filtered.push(
    withQueueRevision({
      kind: 'delete-manifest-node',
      nodeId,
      deletedFileIds: Array.from(
        new Set([
          ...(existingDelete?.deletedFileIds ?? []),
          ...deleted.fileIds,
        ]),
      ),
    }),
  );

  ops.splice(0, ops.length, ...filtered);
}

function arePendingOpsEqual(left: PendingOp, right: PendingOp): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export class CachedRepository
  implements
    Repository,
    YjsSyncTarget,
    RepositoryLifecycle,
    RepositoryStatusSource
{
  public readonly kind: string;
  public readonly capabilities: RepositoryCapabilities;

  private readonly emptyDocUpdate = Y.encodeStateAsUpdate(new Y.Doc());
  private pendingOps: PendingOp[] = [];
  private flushPromise: Promise<void> | null = null;
  private flushTimer: number | null = null;
  private runtimeStatus: RepositoryRuntimeStatus = {
    online: true,
    pendingRemoteWrites: 0,
    lastRemoteSyncAt: null,
    lastError: null,
  };
  private readonly statusListeners = new Set<
    (status: RepositoryRuntimeStatus) => void
  >();

  constructor(
    private readonly remote: BaseRepository,
    private readonly cache: LocalRepository,
    private readonly outboxPathValue: string,
  ) {
    this.kind = remote.kind;
    this.capabilities = remote.capabilities;
  }

  getRuntimeStatus(): RepositoryRuntimeStatus {
    return { ...this.runtimeStatus };
  }

  subscribeStatus(
    listener: (status: RepositoryRuntimeStatus) => void,
  ): () => void {
    this.statusListeners.add(listener);
    listener(this.getRuntimeStatus());
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  async initialize(): Promise<void> {
    await withRepositoryOperationLock(this.remoteSyncLockKey(), async () => {
      await this.initializeImpl();
    });
  }

  private async initializeImpl(): Promise<void> {
    let cacheSnapshot = await this.withLocalStateLock(async () => {
      await this.cache.initialize();
      await this.loadOutbox();
      return this.cache.exportSnapshot();
    });
    logger.debug('Initialized cached repository cache state', {
      repositoryKind: this.kind,
      outboxPath: this.outboxPath(),
      pendingOps: this.pendingOps.length,
    });

    try {
      const remoteSnapshot = await this.remote.exportSnapshot();

      await this.withLocalStateLock(async () => {
        await this.loadOutbox();
        cacheSnapshot = await this.cache.exportSnapshot();
        if (this.pendingOps.length !== 0) {
          return;
        }

        if (!isSnapshotEmpty(remoteSnapshot)) {
          await this.replaceCacheFromRemoteSnapshot(remoteSnapshot);
        } else if (!isSnapshotEmpty(cacheSnapshot)) {
          await this.queueFullCacheSync(cacheSnapshot);
        }
      });
    } catch (error) {
      this.updateRuntimeStatus({
        online: false,
        lastError: error instanceof Error ? error : new Error(String(error)),
      });
      logger.error('Initial remote bootstrap failed', error);
    }

    this.startBackgroundSync();

    try {
      await this.flushPendingInternal();
      await this.syncCacheFromRemote({
        preserveLocalIfRemoteEmpty: true,
      });
    } catch (error) {
      logger.error('Initial outbox flush failed', error);
    }
  }

  async refresh(): Promise<void> {
    await withRepositoryOperationLock(this.remoteSyncLockKey(), async () => {
      await this.refreshImpl();
    });
  }

  async flushPending(): Promise<void> {
    await withRepositoryOperationLock(this.remoteSyncLockKey(), async () => {
      await this.flushPendingInternal();
    });
  }

  private async refreshImpl(): Promise<void> {
    await this.flushPendingInternal();
    await this.syncCacheFromRemote({
      preserveLocalIfRemoteEmpty: true,
    });
  }

  private async flushPendingInternal(): Promise<void> {
    if (!this.flushPromise) {
      this.flushPromise = this.flushPendingImpl()
        .catch((error) => {
          this.updateRuntimeStatus({
            online: false,
            lastError:
              error instanceof Error ? error : new Error(String(error)),
          });
          throw error;
        })
        .finally(() => {
          this.flushPromise = null;
        });
    }

    await this.flushPromise;
  }

  async dispose(): Promise<void> {
    if (this.flushTimer !== null) {
      window.clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  async getNode(nodeId: string): Promise<VFSNode | null> {
    return this.cache.getNode(nodeId);
  }

  async listDirectory(
    folderId: string | null,
  ): Promise<[VFSFolderNode[], VFSFileNode[]]> {
    return this.cache.listDirectory(folderId);
  }

  async getFolderChain(folderId: string | null): Promise<VFSFolderNode[]> {
    return this.cache.getFolderChain(folderId);
  }

  async searchNodes(query: string): Promise<VFSNode[]> {
    return this.cache.searchNodes(query);
  }

  async getNodesByAnyTag(tags: string[]): Promise<VFSNode[]> {
    return this.cache.getNodesByAnyTag(tags);
  }

  async listTags(): Promise<RepositoryTag[]> {
    return this.cache.listTags();
  }

  async getStats(): Promise<RepositoryStats> {
    return this.cache.getStats();
  }

  async getRecentFiles(limit?: number): Promise<VFSFileNode[]> {
    return this.cache.getRecentFiles(limit);
  }

  async getUniqueFileName(
    baseName: string,
    parentId: string | null,
  ): Promise<string> {
    return this.cache.getUniqueFileName(baseName, parentId);
  }

  async createFolder(name: string, parentId: string | null): Promise<string> {
    return this.withLocalStateLock(async () => {
      const nodeId = await this.cache.createFolder(name, parentId);
      await this.mutatePendingOpsInternal((ops) => {
        enqueueUpsertManifestNode(ops, nodeId);
      }, true);
      return nodeId;
    });
  }

  async createFile(
    name: string,
    fileType: FileType,
    parentId: string | null,
    bytes?: Uint8Array,
  ): Promise<string> {
    return this.withLocalStateLock(async () => {
      const nodeId = await this.cache.createFile(
        name,
        fileType,
        parentId,
        bytes,
      );
      await this.mutatePendingOpsInternal((ops) => {
        enqueueUpsertManifestNode(ops, nodeId);
        enqueuePushNote(ops, nodeId, fileType === 'mcanvas' ? undefined : null);
      }, true);
      return nodeId;
    });
  }

  async readFileBytes(nodeId: string): Promise<Uint8Array | null> {
    return this.cache.readFileBytes(nodeId);
  }

  async writeFileBytes(nodeId: string, bytes: Uint8Array): Promise<void> {
    await this.withLocalStateLock(async () => {
      const baseFileRevision = await this.getRawFileBaseRevision(nodeId);
      await this.cache.writeFileBytes(nodeId, bytes);
      await this.mutatePendingOpsInternal((ops) => {
        enqueuePushNote(ops, nodeId, baseFileRevision);
      }, true);
    });
  }

  async renameNode(nodeId: string, newName: string): Promise<void> {
    await this.withLocalStateLock(async () => {
      await this.cache.renameNode(nodeId, newName);
      await this.mutatePendingOpsInternal((ops) => {
        enqueueUpsertManifestNode(ops, nodeId);
      }, true);
    });
  }

  async deleteNode(nodeId: string): Promise<void> {
    await this.withLocalStateLock(async () => {
      const deleted = await this.collectDeletedSubtree(nodeId);
      await this.cache.deleteNode(nodeId);
      await this.mutatePendingOpsInternal((ops) => {
        enqueueDeleteManifestNode(ops, nodeId, deleted);
      }, true);
    });
  }

  async moveNode(nodeId: string, newParentId: string | null): Promise<void> {
    await this.withLocalStateLock(async () => {
      await this.cache.moveNode(nodeId, newParentId);
      await this.mutatePendingOpsInternal((ops) => {
        enqueueUpsertManifestNode(ops, nodeId);
      }, true);
    });
  }

  async setTags(nodeId: string, tags: string[]): Promise<void> {
    await this.withLocalStateLock(async () => {
      await this.cache.setTags(nodeId, tags);
      await this.mutatePendingOpsInternal((ops) => {
        enqueueUpsertManifestNode(ops, nodeId);
      }, true);
    });
  }

  async addTag(nodeId: string, tag: string): Promise<void> {
    await this.withLocalStateLock(async () => {
      await this.cache.addTag(nodeId, tag);
      await this.mutatePendingOpsInternal((ops) => {
        enqueueUpsertManifestNode(ops, nodeId);
      }, true);
    });
  }

  async removeTag(nodeId: string, tag: string): Promise<void> {
    await this.withLocalStateLock(async () => {
      await this.cache.removeTag(nodeId, tag);
      await this.mutatePendingOpsInternal((ops) => {
        enqueueUpsertManifestNode(ops, nodeId);
      }, true);
    });
  }

  async getRevealPath(nodeId: string): Promise<string | null> {
    return this.cache.getRevealPath(nodeId);
  }

  async getCustomColors(): Promise<string[]> {
    return this.cache.getCustomColors();
  }

  async addCustomColor(color: string): Promise<string[]> {
    return this.withLocalStateLock(async () => {
      const result = await this.cache.addCustomColor(color);
      await this.enqueueCustomColorsSyncInternal();
      return result;
    });
  }

  async removeCustomColor(color: string): Promise<string[]> {
    return this.withLocalStateLock(async () => {
      const result = await this.cache.removeCustomColor(color);
      await this.enqueueCustomColorsSyncInternal();
      return result;
    });
  }

  private async enqueueCustomColorsSyncInternal(): Promise<void> {
    await this.mutatePendingOpsInternal((ops) => {
      const existing = ops.find((op) => op.kind === 'sync-custom-colors');
      if (existing) {
        touchPendingOp(existing);
      } else {
        ops.push(withQueueRevision({ kind: 'sync-custom-colors' }));
      }
    }, true);
  }

  private async getRawFileBaseRevision(
    nodeId: string,
  ): Promise<string | null | undefined> {
    const node = await this.cache.getNode(nodeId);
    if (!node || node.type !== 'file' || node.fileType === 'mcanvas') {
      return undefined;
    }
    return computeRevision(await this.cache.readFileBytes(nodeId));
  }

  async openSession(nodeId: string): Promise<NoteSession> {
    logger.debug('Opening cached repository local session', {
      repositoryKind: this.kind,
      nodeId,
      pendingOps: this.pendingOps.length,
    });
    const session = await NoteSession.open(nodeId, this);
    this.refreshOpenSessionInBackground(session);
    return session;
  }

  private refreshOpenSessionInBackground(session: NoteSession): void {
    void this.refreshOpenSession(session).catch((error) => {
      logger.error('Failed to refresh open cached repository session', error, {
        nodeId: session.id,
      });
    });
  }

  private async refreshOpenSession(session: NoteSession): Promise<void> {
    logger.debug('Refreshing open cached repository session in background', {
      repositoryKind: this.kind,
      nodeId: session.id,
      pendingOps: this.pendingOps.length,
    });
    await this.refresh();
    await session.pull();
  }

  async loadDocument(nodeId: string): Promise<YjsSyncSnapshot> {
    return this.cache.loadDocument(nodeId);
  }

  async pullUpdates(
    nodeId: string,
    stateVector?: Uint8Array | null,
  ): Promise<YjsSyncSnapshot> {
    return this.cache.pullUpdates(nodeId, stateVector);
  }

  async pushUpdates(
    nodeId: string,
    update: Uint8Array,
    options: YjsSyncPushOptions,
  ): Promise<YjsSyncPushResult> {
    return this.withLocalStateLock(async () => {
      const result = await this.cache.pushUpdates(nodeId, update, options);
      if (result.accepted) {
        await this.mutatePendingOpsInternal((ops) => {
          enqueuePushNote(ops, nodeId);
        }, true);
        logger.debug('Queued cached note push for remote sync', {
          repositoryKind: this.kind,
          nodeId,
          updateByteLength: update.byteLength,
          pendingOps: this.pendingOps.length,
        });
      }
      return result;
    });
  }

  private startBackgroundSync(): void {
    if (this.flushTimer !== null || typeof window === 'undefined') {
      return;
    }

    this.flushTimer = window.setInterval(() => {
      void this.flushPending().catch((error) => {
        logger.error('Background flush failed', error);
      });
    }, BACKGROUND_SYNC_INTERVAL_MS);
  }

  private async flushPendingImpl(): Promise<void> {
    let pendingOps = await this.withLocalStateLock(async () => {
      await this.loadOutbox();
      return this.pendingOps.length;
    });
    logger.debug('Flushing cached repository pending ops', {
      repositoryKind: this.kind,
      pendingOps,
      outboxPath: this.outboxPath(),
    });

    while (true) {
      const pending = await this.withLocalStateLock(async () => {
        await this.loadOutbox();
        const op = this.pendingOps[0];
        if (!op) {
          return null;
        }
        return {
          op: structuredClone(op),
          pendingOps: this.pendingOps.length,
        };
      });
      if (!pending) {
        break;
      }

      logger.debug('Applying cached repository pending op', {
        repositoryKind: this.kind,
        opKind: pending.op.kind,
        nodeId: 'nodeId' in pending.op ? pending.op.nodeId : null,
        pendingOps: pending.pendingOps,
      });

      await this.applyPendingOp(pending.op);

      const removed = await this.withLocalStateLock(async () => {
        await this.loadOutbox();
        const currentOp = this.pendingOps[0];
        if (!currentOp || !arePendingOpsEqual(currentOp, pending.op)) {
          logger.debug(
            'Leaving applied cached pending op queued because the head op changed during remote sync',
            {
              repositoryKind: this.kind,
              opKind: pending.op.kind,
              nodeId: 'nodeId' in pending.op ? pending.op.nodeId : null,
              pendingOps: this.pendingOps.length,
            },
          );
          this.updateRuntimeStatus({
            online: true,
            pendingRemoteWrites: this.pendingOps.length,
            lastRemoteSyncAt: Date.now(),
            lastError: null,
          });
          return false;
        }

        this.pendingOps.shift();
        await this.saveOutbox();
        this.updateRuntimeStatus({
          online: true,
          pendingRemoteWrites: this.pendingOps.length,
          lastRemoteSyncAt: Date.now(),
          lastError: null,
        });
        return true;
      });

      if (!removed) {
        break;
      }
    }

    pendingOps = await this.withLocalStateLock(async () => {
      await this.loadOutbox();
      return this.pendingOps.length;
    });
    logger.debug('Flushed cached repository pending ops', {
      repositoryKind: this.kind,
      pendingOps,
    });
  }

  private async applyPendingOp(op: PendingOp): Promise<void> {
    switch (op.kind) {
      case 'upsert-manifest-node':
        await this.applyManifestUpsert(op.nodeId);
        return;
      case 'delete-manifest-node':
        await this.applyManifestDelete(op);
        return;
      case 'push-note':
        await this.applyNotePush(op);
        return;
      case 'sync-custom-colors':
        await this.applyCustomColorsSync();
        return;
    }
  }

  private async applyCustomColorsSync(): Promise<void> {
    // Cache is the source of truth — overwriting remote is what lets deletes
    // propagate (a merge-only strategy could never remove).
    const cacheColors = await this.withLocalStateLock(() =>
      this.cache.getCustomColors(),
    );
    await this.remote.applyManifestMutation(
      'Sync custom colors',
      (remoteManifest) => {
        remoteManifest.customColors = [...cacheColors];
      },
    );
  }

  private async applyManifestUpsert(nodeId: string): Promise<void> {
    const cacheSnapshot = await this.withLocalStateLock(() =>
      this.cache.exportSnapshot(),
    );
    await this.remote.applyManifestMutation(
      `Sync manifest node ${nodeId}`,
      (remoteManifest) => {
        applyManifestUpsert(remoteManifest, cacheSnapshot.manifest, nodeId);
      },
    );
    logger.debug('Applied cached manifest upsert to remote', {
      repositoryKind: this.kind,
      nodeId,
      cacheNodeCount: Object.keys(cacheSnapshot.manifest.nodes).length,
    });
  }

  private async applyManifestDelete(
    op: Extract<PendingOp, { kind: 'delete-manifest-node' }>,
  ): Promise<void> {
    await Promise.all(
      op.deletedFileIds.map(async (nodeId) => {
        await this.remote.removeNoteData(nodeId);
      }),
    );

    await this.remote.applyManifestMutation(
      `Delete manifest node ${op.nodeId}`,
      (remoteManifest) => {
        deleteNodeFromManifest(remoteManifest, op.nodeId);
      },
    );
    logger.debug('Applied cached manifest delete to remote', {
      repositoryKind: this.kind,
      nodeId: op.nodeId,
      deletedFileIds: op.deletedFileIds,
    });
  }

  private async applyNotePush(
    op: Extract<PendingOp, { kind: 'push-note' }>,
  ): Promise<void> {
    const nodeId = op.nodeId;
    const localState = await this.withLocalStateLock(async () => {
      const node = await this.cache.getNode(nodeId);
      if (!node || node.type !== 'file') {
        return { kind: 'missing' as const };
      }

      if (node.fileType !== 'mcanvas') {
        return {
          kind: 'raw-file' as const,
          node,
          bytes: await this.cache.readFileBytes(nodeId),
        };
      }

      return {
        kind: 'canvas-note' as const,
        node,
        snapshot: await this.cache.loadDocument(nodeId),
      };
    });

    if (localState.kind === 'missing') {
      logger.debug('Skipped cached note push because file no longer exists', {
        repositoryKind: this.kind,
        nodeId,
      });
      return;
    }

    const node = localState.node;
    if (node.fileType !== 'mcanvas') {
      const bytes = localState.kind === 'raw-file' ? localState.bytes : null;
      if (op.baseFileRevision !== undefined) {
        const remoteBytes = await this.remote.readFileBytes(nodeId);
        const remoteRevision = await computeRevision(remoteBytes);
        if (remoteRevision !== op.baseFileRevision) {
          await this.createRawFileConflictCopy(
            node,
            bytes ?? new Uint8Array(),
            remoteBytes,
          );
          logger.debug('Created raw file conflict copy', {
            repositoryKind: this.kind,
            nodeId,
            fileType: node.fileType,
            baseFileRevision: op.baseFileRevision,
            remoteRevision,
          });
          return;
        }
      }

      await this.remote.writeFileBytes(nodeId, bytes ?? new Uint8Array());
      logger.debug('Applied cached file push to remote', {
        repositoryKind: this.kind,
        nodeId,
        fileType: node.fileType,
        byteLength: bytes?.byteLength ?? 0,
      });
      return;
    }

    if (localState.kind !== 'canvas-note') {
      return;
    }

    const localSnapshot = localState.snapshot;
    const update = localSnapshot.update ?? this.emptyDocUpdate;
    logger.debug('Applying cached note push to remote', {
      repositoryKind: this.kind,
      nodeId,
      revision: localSnapshot.revision,
      stateVectorByteLength: localSnapshot.stateVector.byteLength,
      ...summarizeNoteBytes(localSnapshot.update),
    });

    for (let attempt = 0; attempt < 4; attempt++) {
      const remoteSnapshot = await this.remote.loadDocument(nodeId);
      const result = await this.remote.pushUpdates(nodeId, update, {
        baseRevision: remoteSnapshot.revision,
        localStateVector: localSnapshot.stateVector,
      });

      if (result.accepted) {
        logger.debug('Applied cached note push to remote', {
          repositoryKind: this.kind,
          nodeId,
          attempt: attempt + 1,
          revision: result.revision,
          stateVectorByteLength: result.stateVector.byteLength,
          ...summarizeNoteBytes(result.update),
        });
        return;
      }

      logger.debug('Remote rejected cached note push; retrying', {
        repositoryKind: this.kind,
        nodeId,
        attempt: attempt + 1,
        revision: result.revision,
        remoteUpdateByteLength: result.remoteUpdate?.byteLength ?? 0,
      });
    }

    throw new Error(`Failed to sync note ${nodeId} after retrying conflicts.`);
  }

  private async createRawFileConflictCopy(
    localNode: VFSFileNode,
    localBytes: Uint8Array,
    remoteBytes: Uint8Array | null,
  ): Promise<void> {
    const remoteNode = await this.remote.getNode(localNode.id);
    const originalRemoteNode =
      remoteNode?.type === 'file' ? structuredClone(remoteNode) : null;
    const conflictId = createNodeId();
    const now = Date.now();
    const timestamp = new Date(now);
    let conflictNode: VFSFileNode | null = null;

    await this.remote.applyManifestMutation(
      `Create conflict copy for file ${localNode.id}`,
      (manifest) => {
        const parentId = getExistingParentId(
          manifest,
          originalRemoteNode?.parentId ?? localNode.parentId,
        );
        const name = getUniqueFileName(
          manifest,
          getConflictedFileName(localNode.name, timestamp),
          parentId,
        );
        conflictNode = {
          ...createFileNode(
            conflictId,
            name,
            localNode.fileType,
            parentId,
            now,
          ),
          tags: [...localNode.tags],
        };
        manifest.nodes[conflictId] = conflictNode;
        addChild(manifest, parentId, conflictId);
      },
    );

    await this.remote.writeFileBytes(conflictId, localBytes);

    if (!conflictNode) {
      return;
    }

    await this.withLocalStateLock(async () => {
      await this.cache.applyManifestMutation(
        `Apply conflict copy for file ${localNode.id}`,
        (manifest) => {
          if (originalRemoteNode) {
            const parentId = getExistingParentId(
              manifest,
              originalRemoteNode.parentId,
            );
            detachNodeFromAllContainers(manifest, originalRemoteNode.id);
            manifest.nodes[originalRemoteNode.id] = {
              ...originalRemoteNode,
              parentId,
            };
            addChild(manifest, parentId, originalRemoteNode.id);
          } else {
            deleteNodeFromManifest(manifest, localNode.id);
          }

          const parentId = getExistingParentId(
            manifest,
            conflictNode!.parentId,
          );
          manifest.nodes[conflictId] = {
            ...conflictNode!,
            parentId,
          };
          addChild(manifest, parentId, conflictId);
        },
      );

      if (originalRemoteNode) {
        await this.cache.writeFileBytes(
          originalRemoteNode.id,
          remoteBytes ?? new Uint8Array(),
        );
      }
      await this.cache.writeFileBytes(conflictId, localBytes);
    });
  }

  private async collectDeletedSubtree(nodeId: string): Promise<DeletedSubtree> {
    const node = await this.cache.getNode(nodeId);
    if (!node) {
      return { nodeIds: [nodeId], fileIds: [] };
    }

    if (node.type === 'file') {
      return { nodeIds: [nodeId], fileIds: [nodeId] };
    }

    const childEntries = await Promise.all(
      node.children.map((childId) => this.collectDeletedSubtree(childId)),
    );

    return {
      nodeIds: [nodeId, ...childEntries.flatMap((entry) => entry.nodeIds)],
      fileIds: childEntries.flatMap((entry) => entry.fileIds),
    };
  }

  private async mutatePendingOpsInternal(
    mutator: (ops: PendingOp[]) => void,
    reloadFromDisk: boolean,
  ): Promise<void> {
    if (reloadFromDisk) {
      await this.loadOutbox();
    }

    mutator(this.pendingOps);
    await this.saveOutbox();
    this.updateRuntimeStatus({
      pendingRemoteWrites: this.pendingOps.length,
    });
  }

  private async queueFullCacheSync(
    snapshot: RepositorySnapshot,
  ): Promise<void> {
    await this.mutatePendingOpsInternal((ops) => {
      for (const node of Object.values(snapshot.manifest.nodes)) {
        enqueueUpsertManifestNode(ops, node.id);
        if (node.type === 'file') {
          enqueuePushNote(
            ops,
            node.id,
            node.fileType === 'mcanvas' ? undefined : null,
          );
        }
      }
    }, false);
  }

  private async ensureOutboxDir(): Promise<void> {
    const parentPath = getParentPath(this.outboxPath());
    if (!parentPath) {
      return;
    }

    if (!(await exists(parentPath, { baseDir: BaseDirectory.AppData }))) {
      await mkdir(parentPath, {
        baseDir: BaseDirectory.AppData,
        recursive: true,
      });
    }
  }

  private async loadOutbox(): Promise<void> {
    await this.ensureOutboxDir();

    const path = this.outboxPath();
    if (!(await exists(path, { baseDir: BaseDirectory.AppData }))) {
      this.pendingOps = [];
      this.updateRuntimeStatus({ pendingRemoteWrites: 0 });
      return;
    }

    try {
      const raw = await readTextFile(path, { baseDir: BaseDirectory.AppData });
      this.pendingOps = JSON.parse(raw) as PendingOp[];
      this.updateRuntimeStatus({ pendingRemoteWrites: this.pendingOps.length });
      logger.debug('Loaded cached repository outbox', {
        repositoryKind: this.kind,
        outboxPath: path,
        pendingOps: this.pendingOps.length,
      });
    } catch {
      this.pendingOps = [];
      await this.saveOutbox();
    }
  }

  private async saveOutbox(): Promise<void> {
    await this.ensureOutboxDir();
    await writeTextFile(this.outboxPath(), JSON.stringify(this.pendingOps), {
      baseDir: BaseDirectory.AppData,
    });
    logger.debug('Saved cached repository outbox', {
      repositoryKind: this.kind,
      outboxPath: this.outboxPath(),
      pendingOps: this.pendingOps.length,
    });
  }

  private outboxPath(): string {
    return this.outboxPathValue;
  }

  private remoteSyncLockKey(): string {
    return `${this.outboxPath()}::remote-sync`;
  }

  private async withLocalStateLock<T>(operation: () => Promise<T>): Promise<T> {
    return withRepositoryOperationLock(this.outboxPath(), operation);
  }

  private async syncCacheFromRemote(options?: {
    preserveLocalIfRemoteEmpty?: boolean;
  }): Promise<void> {
    const remoteSnapshot = await this.remote.exportSnapshot();

    await this.withLocalStateLock(async () => {
      await this.loadOutbox();
      const cacheSnapshot = await this.cache.exportSnapshot();
      logger.debug('Syncing cache from remote snapshot', {
        repositoryKind: this.kind,
        preserveLocalIfRemoteEmpty:
          options?.preserveLocalIfRemoteEmpty ?? false,
        pendingOps: this.pendingOps.length,
        cacheNodeCount: Object.keys(cacheSnapshot.manifest.nodes).length,
        cacheNoteCount: Object.keys(cacheSnapshot.notes).length,
        remoteNodeCount: Object.keys(remoteSnapshot.manifest.nodes).length,
        remoteNoteCount: Object.keys(remoteSnapshot.notes).length,
      });

      if (this.pendingOps.length !== 0) {
        logger.debug(
          'Skipped replacing cache from remote because local pending ops exist',
          {
            repositoryKind: this.kind,
            pendingOps: this.pendingOps.length,
          },
        );
        this.updateRuntimeStatus({
          online: true,
          lastRemoteSyncAt: Date.now(),
          lastError: null,
        });
        return;
      }

      if (
        options?.preserveLocalIfRemoteEmpty &&
        isSnapshotEmpty(remoteSnapshot) &&
        !isSnapshotEmpty(cacheSnapshot)
      ) {
        logger.debug('Preserved local cache because remote snapshot is empty', {
          repositoryKind: this.kind,
        });
        this.updateRuntimeStatus({
          online: true,
          lastRemoteSyncAt: Date.now(),
          lastError: null,
        });
        return;
      }

      await this.replaceCacheFromRemoteSnapshot(remoteSnapshot);
    });
  }

  private async replaceCacheFromRemoteSnapshot(
    remoteSnapshot: RepositorySnapshot,
  ): Promise<void> {
    await this.cache.replaceSnapshot(remoteSnapshot);
    this.updateRuntimeStatus({
      online: true,
      lastRemoteSyncAt: Date.now(),
      lastError: null,
    });
    logger.debug('Replaced cache from remote snapshot', {
      repositoryKind: this.kind,
      remoteNodeCount: Object.keys(remoteSnapshot.manifest.nodes).length,
      remoteNoteCount: Object.keys(remoteSnapshot.notes).length,
    });
  }

  private updateRuntimeStatus(patch: Partial<RepositoryRuntimeStatus>): void {
    this.runtimeStatus = { ...this.runtimeStatus, ...patch };
    const snapshot = this.getRuntimeStatus();
    for (const listener of this.statusListeners) {
      listener(snapshot);
    }
  }
}
