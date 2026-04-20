import * as Y from 'yjs';
import {
  BaseDirectory,
  exists,
  mkdir,
  readTextFile,
  writeTextFile,
} from '@tauri-apps/plugin-fs';
import { Logger } from '@/lib/logger';
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
  deleteNodeFromManifest,
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
  | { kind: 'upsert-manifest-node'; nodeId: string }
  | { kind: 'delete-manifest-node'; nodeId: string; deletedFileIds: string[] }
  | { kind: 'push-note'; nodeId: string };

interface DeletedSubtree {
  nodeIds: string[];
  fileIds: string[];
}

const BACKGROUND_SYNC_INTERVAL_MS = 15_000;
const logger = new Logger('CachedRepository');

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

function enqueueUpsertManifestNode(ops: PendingOp[], nodeId: string): void {
  const alreadyDeleted = ops.some(
    (op) => op.kind === 'delete-manifest-node' && op.nodeId === nodeId,
  );
  if (alreadyDeleted) {
    return;
  }

  const filtered = ops.filter(
    (op) => !(op.kind === 'upsert-manifest-node' && op.nodeId === nodeId),
  );
  filtered.push({ kind: 'upsert-manifest-node', nodeId });
  ops.splice(0, ops.length, ...filtered);
}

function enqueuePushNote(ops: PendingOp[], nodeId: string): void {
  const alreadyDeleted = ops.some(
    (op) =>
      op.kind === 'delete-manifest-node' && op.deletedFileIds.includes(nodeId),
  );
  if (alreadyDeleted) {
    return;
  }

  if (ops.some((op) => op.kind === 'push-note' && op.nodeId === nodeId)) {
    return;
  }

  ops.push({ kind: 'push-note', nodeId });
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

  filtered.push({
    kind: 'delete-manifest-node',
    nodeId,
    deletedFileIds: Array.from(
      new Set([...(existingDelete?.deletedFileIds ?? []), ...deleted.fileIds]),
    ),
  });

  ops.splice(0, ops.length, ...filtered);
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
    await this.cache.initialize();
    await this.loadOutbox();

    try {
      const cacheSnapshot = await this.cache.exportSnapshot();
      const remoteSnapshot = await this.remote.exportSnapshot();

      if (this.pendingOps.length === 0) {
        if (!isSnapshotEmpty(remoteSnapshot)) {
          await this.replaceCacheFromRemoteSnapshot(remoteSnapshot);
        } else if (!isSnapshotEmpty(cacheSnapshot)) {
          await this.queueFullCacheSync(cacheSnapshot);
        }
      }
    } catch (error) {
      this.updateRuntimeStatus({
        online: false,
        lastError: error instanceof Error ? error : new Error(String(error)),
      });
      logger.error('Initial remote bootstrap failed', error);
    }

    this.startBackgroundSync();

    try {
      await this.flushPending();
      await this.syncCacheFromRemote({
        preserveLocalIfRemoteEmpty: true,
      });
    } catch (error) {
      logger.error('Initial outbox flush failed', error);
    }
  }

  async refresh(): Promise<void> {
    await this.flushPending();
    await this.syncCacheFromRemote({
      preserveLocalIfRemoteEmpty: true,
    });
  }

  async flushPending(): Promise<void> {
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
    const nodeId = await this.cache.createFolder(name, parentId);
    await this.mutatePendingOps((ops) => {
      enqueueUpsertManifestNode(ops, nodeId);
    });
    return nodeId;
  }

  async createFile(
    name: string,
    fileType: FileType,
    parentId: string | null,
  ): Promise<string> {
    const nodeId = await this.cache.createFile(name, fileType, parentId);
    await this.mutatePendingOps((ops) => {
      enqueueUpsertManifestNode(ops, nodeId);
      enqueuePushNote(ops, nodeId);
    });
    return nodeId;
  }

  async renameNode(nodeId: string, newName: string): Promise<void> {
    await this.cache.renameNode(nodeId, newName);
    await this.mutatePendingOps((ops) => {
      enqueueUpsertManifestNode(ops, nodeId);
    });
  }

  async deleteNode(nodeId: string): Promise<void> {
    const deleted = await this.collectDeletedSubtree(nodeId);
    await this.cache.deleteNode(nodeId);
    await this.mutatePendingOps((ops) => {
      enqueueDeleteManifestNode(ops, nodeId, deleted);
    });
  }

  async moveNode(nodeId: string, newParentId: string | null): Promise<void> {
    await this.cache.moveNode(nodeId, newParentId);
    await this.mutatePendingOps((ops) => {
      enqueueUpsertManifestNode(ops, nodeId);
    });
  }

  async setTags(nodeId: string, tags: string[]): Promise<void> {
    await this.cache.setTags(nodeId, tags);
    await this.mutatePendingOps((ops) => {
      enqueueUpsertManifestNode(ops, nodeId);
    });
  }

  async addTag(nodeId: string, tag: string): Promise<void> {
    await this.cache.addTag(nodeId, tag);
    await this.mutatePendingOps((ops) => {
      enqueueUpsertManifestNode(ops, nodeId);
    });
  }

  async removeTag(nodeId: string, tag: string): Promise<void> {
    await this.cache.removeTag(nodeId, tag);
    await this.mutatePendingOps((ops) => {
      enqueueUpsertManifestNode(ops, nodeId);
    });
  }

  async getRevealPath(nodeId: string): Promise<string | null> {
    return this.cache.getRevealPath(nodeId);
  }

  async openSession(nodeId: string): Promise<NoteSession> {
    try {
      await this.refresh();
    } catch (error) {
      logger.error('Failed to refresh before opening session', error, {
        nodeId,
      });
    }
    return NoteSession.open(nodeId, this);
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
    const result = await this.cache.pushUpdates(nodeId, update, options);
    if (result.accepted) {
      await this.mutatePendingOps((ops) => {
        enqueuePushNote(ops, nodeId);
      });
    }
    return result;
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
    while (this.pendingOps.length > 0) {
      const op = this.pendingOps[0];
      await this.applyPendingOp(op);
      this.pendingOps.shift();
      await this.saveOutbox();
      this.updateRuntimeStatus({
        online: true,
        pendingRemoteWrites: this.pendingOps.length,
        lastRemoteSyncAt: Date.now(),
        lastError: null,
      });
    }
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
        await this.applyNotePush(op.nodeId);
        return;
    }
  }

  private async applyManifestUpsert(nodeId: string): Promise<void> {
    const cacheSnapshot = await this.cache.exportSnapshot();
    await this.remote.applyManifestMutation(
      `Sync manifest node ${nodeId}`,
      (remoteManifest) => {
        applyManifestUpsert(remoteManifest, cacheSnapshot.manifest, nodeId);
      },
    );
  }

  private async applyManifestDelete(
    op: Extract<PendingOp, { kind: 'delete-manifest-node' }>,
  ): Promise<void> {
    await this.remote.applyManifestMutation(
      `Delete manifest node ${op.nodeId}`,
      (remoteManifest) => {
        deleteNodeFromManifest(remoteManifest, op.nodeId);
      },
    );

    await Promise.all(
      op.deletedFileIds.map(async (nodeId) => {
        await this.remote.removeNoteData(nodeId);
      }),
    );
  }

  private async applyNotePush(nodeId: string): Promise<void> {
    const node = await this.cache.getNode(nodeId);
    if (!node || node.type !== 'file') {
      return;
    }

    const localSnapshot = await this.cache.loadDocument(nodeId);
    const update = localSnapshot.update ?? this.emptyDocUpdate;

    for (let attempt = 0; attempt < 4; attempt++) {
      const remoteSnapshot = await this.remote.loadDocument(nodeId);
      const result = await this.remote.pushUpdates(nodeId, update, {
        baseRevision: remoteSnapshot.revision,
        localStateVector: localSnapshot.stateVector,
      });

      if (result.accepted) {
        return;
      }
    }

    throw new Error(`Failed to sync note ${nodeId} after retrying conflicts.`);
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

  private async mutatePendingOps(
    mutator: (ops: PendingOp[]) => void,
  ): Promise<void> {
    mutator(this.pendingOps);
    await this.saveOutbox();
    this.updateRuntimeStatus({
      pendingRemoteWrites: this.pendingOps.length,
    });
  }

  private async queueFullCacheSync(
    snapshot: RepositorySnapshot,
  ): Promise<void> {
    await this.mutatePendingOps((ops) => {
      for (const node of Object.values(snapshot.manifest.nodes)) {
        enqueueUpsertManifestNode(ops, node.id);
        if (node.type === 'file') {
          enqueuePushNote(ops, node.id);
        }
      }
    });
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
  }

  private outboxPath(): string {
    return this.outboxPathValue;
  }

  private async syncCacheFromRemote(options?: {
    preserveLocalIfRemoteEmpty?: boolean;
  }): Promise<void> {
    const cacheSnapshot = await this.cache.exportSnapshot();
    const remoteSnapshot = await this.remote.exportSnapshot();

    if (
      options?.preserveLocalIfRemoteEmpty &&
      isSnapshotEmpty(remoteSnapshot) &&
      !isSnapshotEmpty(cacheSnapshot)
    ) {
      return;
    }

    await this.replaceCacheFromRemoteSnapshot(remoteSnapshot);
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
  }

  private updateRuntimeStatus(patch: Partial<RepositoryRuntimeStatus>): void {
    this.runtimeStatus = { ...this.runtimeStatus, ...patch };
    const snapshot = this.getRuntimeStatus();
    for (const listener of this.statusListeners) {
      listener(snapshot);
    }
  }
}
