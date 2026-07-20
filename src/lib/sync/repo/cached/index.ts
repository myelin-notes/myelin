import * as Y from 'yjs';
import { summarizeNoteBytes } from '@myelin/editor/note/state-summary';
import { trackEvent } from '@/lib/analytics';
import { Logger } from '@/lib/logger';
import type { ReindexItem } from '@/platform';
import { NoteSession } from '../../session';
import type {
  YjsSyncPushOptions,
  YjsSyncPushResult,
  YjsSyncSnapshot,
  YjsSyncTarget,
} from '../../types';
import type { BaseRepository } from '../base';
import type {
  RepositoryLifecycle,
  RepositoryRuntimeStatus,
  RepositoryStatusSource,
} from '../config';
import type { LocalRepository } from '../local';
import {
  addChild,
  computeRevision,
  createFileNode,
  createNodeId,
  deleteNodeFromManifest,
  ensureVersionHistoryRoot,
  getUniqueFileName,
  isFileVersionNode as isConcreteFileVersionNode,
  type RepositorySnapshot,
  toFileVersion,
  VERSION_HISTORY_INTERVAL_MS,
  VERSION_HISTORY_MAX_PER_FILE,
} from '../shared';
import type {
  CreateFileOptions,
  FileType,
  FileVersion,
  NodeSearchResult,
  NoteBacklink,
  Repository,
  RepositoryCapabilities,
  RepositoryNoteGraph,
  RepositoryStats,
  RepositoryTag,
  SearchNodesOptions,
  VFSFileNode,
  VFSFolderNode,
  VFSNode,
  VFSNodeId,
} from '../types';
import { withAsyncKeyedMutex } from './lock';
import {
  CachedRepositoryOutbox,
  type DeletedSubtree,
  enqueueCustomColorsSync,
  enqueueDeleteManifestNode,
  enqueuePushNote,
  enqueueTagRegistrySync,
  enqueueUpsertManifestNode,
  type PendingOp,
} from './outbox';
import {
  applyCachedManifestUpsert,
  detachNodeFromAllContainers,
  getConflictedFileName,
  getExistingParentId,
} from './reconcile';

const BACKGROUND_SYNC_INTERVAL_MS = 30_000;
const logger = new Logger('CachedRepository');

class RemoteNoteCacheMergeError extends Error {
  constructor(nodeId: VFSNodeId) {
    super(`Failed to merge remote note ${nodeId} into cache.`);
    this.name = 'RemoteNoteCacheMergeError';
  }
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
  private readonly outbox: CachedRepositoryOutbox;
  private flushPromise: Promise<void> | null = null;
  private flushTimer: number | null = null;
  private runtimeStatus: RepositoryRuntimeStatus = {
    online: true,
    pendingRemoteWrites: 0,
    lastRemoteSyncAt: null,
    lastError: null,
    dataVersion: 0,
  };
  private readonly statusListeners = new Set<
    (status: RepositoryRuntimeStatus) => void
  >();

  constructor(
    private readonly remote: BaseRepository,
    private readonly cache: LocalRepository,
    outboxPath: string,
  ) {
    this.kind = remote.kind;
    this.capabilities = remote.capabilities;
    this.outbox = new CachedRepositoryOutbox({
      path: outboxPath,
      repositoryKind: this.kind,
      onPendingWritesChanged: (count) => {
        this.updateRuntimeStatus({ pendingRemoteWrites: count });
      },
      onRecoveryError: (error) => {
        this.updateRuntimeStatus({
          online: false,
          pendingRemoteWrites: 0,
          lastError: error,
        });
      },
    });
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
    await withAsyncKeyedMutex(this.remoteSyncMutexKey(), async () => {
      await this.initializeImpl();
    });
  }

  private async initializeImpl(): Promise<void> {
    let didBootstrapFromRemote = false;

    await this.withLocalStateLock(async () => {
      await this.cache.initialize();
      await this.outbox.load();
    });
    logger.debug('Initialized cached repository cache state', {
      repositoryKind: this.kind,
      outboxPath: this.outboxPath(),
      pendingOps: this.outbox.length,
    });

    try {
      const remoteSnapshot = await this.remote.exportSnapshot();

      await this.withLocalStateLock(async () => {
        await this.outbox.load();
        if (this.outbox.recoveryError) {
          logger.error(
            'Skipped initial remote bootstrap because cached repository outbox requires recovery',
            this.outbox.recoveryError,
            {
              repositoryKind: this.kind,
              outboxPath: this.outboxPath(),
            },
          );
          return;
        }
        if (this.outbox.length !== 0) {
          return;
        }

        await this.replaceCacheFromRemoteSnapshot(remoteSnapshot);
        didBootstrapFromRemote = true;
      });
    } catch (error) {
      this.updateRuntimeStatus({
        online: false,
        lastError: error instanceof Error ? error : new Error(String(error)),
      });
      logger.error('Initial remote bootstrap failed', error);
    }

    this.startBackgroundSync();

    if (!didBootstrapFromRemote) {
      try {
        await this.syncCacheFromRemote();
      } catch (error) {
        logger.error('Initial remote pull failed', error);
      }
    }
  }

  async refresh(): Promise<void> {
    await withAsyncKeyedMutex(this.remoteSyncMutexKey(), async () => {
      await this.refreshImpl();
    });
  }

  async flushPending(): Promise<void> {
    await withAsyncKeyedMutex(this.remoteSyncMutexKey(), async () => {
      await this.flushPendingInternal();
    });
  }

  private async refreshImpl(): Promise<void> {
    await this.syncCacheFromRemote();
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
    // Skip the final flush when there's nothing to push. flushPending acquires
    // the remoteSync mutex, which an in-flight background sync may be holding —
    // that wait dominates window-close time (seconds) even though our outbox
    // is already empty. The in-flight sync owns the same work we'd do, and the
    // outbox is durable, so abandoning the wait is safe.
    if (this.outbox.length === 0) {
      return;
    }
    try {
      await this.flushPending();
    } catch (error) {
      logger.error('Final outbox flush during dispose failed', error);
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

  async searchNodes(
    query: string,
    options?: SearchNodesOptions,
  ): Promise<NodeSearchResult[]> {
    return this.cache.searchNodes(query, options);
  }

  async getNodesByName(name: string): Promise<VFSNode[]> {
    return this.cache.getNodesByName(name);
  }

  async listIndexBackfillItems(): Promise<ReindexItem[]> {
    return this.cache.listIndexBackfillItems();
  }

  async getNodesByAnyTag(
    tags: string[],
    folderId: VFSNodeId | null = null,
  ): Promise<VFSNode[]> {
    return this.cache.getNodesByAnyTag(tags, folderId);
  }

  async listTags(includeAncestors = false): Promise<RepositoryTag[]> {
    return this.cache.listTags(includeAncestors);
  }

  async getStats(): Promise<RepositoryStats> {
    return this.cache.getStats();
  }

  async getRecentFiles(limit?: number): Promise<VFSFileNode[]> {
    return this.cache.getRecentFiles(limit);
  }

  async getBacklinks(noteId: VFSNodeId): Promise<NoteBacklink[]> {
    return this.cache.getBacklinks(noteId);
  }

  async getNoteGraph(): Promise<RepositoryNoteGraph> {
    return this.cache.getNoteGraph();
  }

  async getUniqueFileName(
    baseName: string,
    parentId: string | null,
  ): Promise<string> {
    return this.cache.getUniqueFileName(baseName, parentId);
  }

  private async writeLocalAndQueue<T>(
    writeLocal: () => Promise<T>,
    queueRemoteWrite: (ops: PendingOp[], result: T) => void,
  ): Promise<T> {
    return this.withLocalStateLock(async () => {
      const result = await writeLocal();
      await this.outbox.mutate((ops) => {
        queueRemoteWrite(ops, result);
      });
      this.updateRuntimeStatus({
        dataVersion: this.runtimeStatus.dataVersion + 1,
      });
      return result;
    });
  }

  async batchManifestWrites<T>(fn: () => Promise<T>): Promise<T> {
    return this.cache.batchManifestWrites(fn);
  }

  async createFolder(name: string, parentId: string | null): Promise<string> {
    return this.writeLocalAndQueue(
      () => this.cache.createFolder(name, parentId),
      (ops, nodeId) => {
        enqueueUpsertManifestNode(ops, nodeId);
      },
    );
  }

  async createFile(
    name: string,
    fileType: FileType,
    parentId: string | null,
    bytes?: Uint8Array,
    options?: CreateFileOptions,
  ): Promise<VFSNodeId> {
    return this.writeLocalAndQueue(
      () => this.cache.createFile(name, fileType, parentId, bytes, options),
      (ops, nodeId) => {
        enqueueUpsertManifestNode(ops, nodeId);
        enqueuePushNote(ops, nodeId, fileType === 'mcanvas' ? undefined : null);
      },
    );
  }

  async listFileVersions(nodeId: VFSNodeId): Promise<FileVersion[]> {
    return this.cache.listFileVersions(nodeId);
  }

  async createFileVersionIfDue(
    nodeId: VFSNodeId,
    options: { force?: boolean } = {},
  ): Promise<FileVersion | null> {
    const node = await this.cache.getNode(nodeId);
    if (!node || node.type !== 'file' || node.system) {
      return null;
    }

    const bytes = await this.cache.readFileBytes(nodeId);
    if (!bytes) {
      return null;
    }

    const now = Date.now();
    const sourceRevision = await computeRevision(bytes);
    const versions = await this.listFileVersions(nodeId);
    const latest = versions[0];
    if (versions.some((version) => version.sourceRevision === sourceRevision)) {
      return null;
    }
    if (
      !options.force &&
      latest &&
      now - latest.capturedAt < VERSION_HISTORY_INTERVAL_MS
    ) {
      return null;
    }

    const parentId = await this.getOrCreateVersionHistoryRoot();
    const versionId = await this.createFile(
      `${node.name} ${new Date(now).toISOString()}`,
      node.fileType,
      parentId,
      bytes,
      {
        system: {
          kind: 'file-version',
          sourceFileId: node.id,
          sourceFileType: node.fileType,
          sourceName: node.name,
          sourceRevision,
          capturedAt: now,
          byteLength: bytes.byteLength,
        },
      },
    );

    await this.enforceFileVersionLimit(nodeId);

    const versionNode = await this.cache.getNode(versionId);
    return isConcreteFileVersionNode(versionNode)
      ? toFileVersion(versionNode)
      : null;
  }

  async restoreFileVersion(
    nodeId: VFSNodeId,
    versionId: VFSNodeId,
  ): Promise<void> {
    const versionNode = await this.cache.getNode(versionId);
    if (
      !isConcreteFileVersionNode(versionNode) ||
      versionNode.system.sourceFileId !== nodeId
    ) {
      throw new Error('Version does not belong to this file.');
    }

    const bytes = await this.cache.readFileBytes(versionId);
    if (!bytes) {
      throw new Error('Version data is missing.');
    }
    const currentBytes = await this.cache.readFileBytes(nodeId);
    const versionRevision = await computeRevision(bytes);
    if (
      currentBytes &&
      (await computeRevision(currentBytes)) === versionRevision
    ) {
      return;
    }
    await this.createFileVersionIfDue(nodeId, { force: true });
    await this.replaceFileBytes(nodeId, bytes);
  }

  async readFileBytes(nodeId: VFSNodeId): Promise<Uint8Array | null> {
    return this.cache.readFileBytes(nodeId);
  }

  async writeFileBytes(nodeId: VFSNodeId, bytes: Uint8Array): Promise<void> {
    await this.writeLocalAndQueue(
      async () => {
        const baseFileRevision = await this.getRawFileBaseRevision(nodeId);
        await this.cache.writeFileBytes(nodeId, bytes);
        return baseFileRevision;
      },
      (ops, baseFileRevision) => {
        enqueuePushNote(ops, nodeId, baseFileRevision);
      },
    );
  }

  private async replaceFileBytes(
    nodeId: VFSNodeId,
    bytes: Uint8Array,
  ): Promise<void> {
    await this.writeLocalAndQueue(
      async () => {
        await this.cache.writeFileBytes(nodeId, bytes);
      },
      (ops) => {
        enqueuePushNote(ops, nodeId, undefined, { replaceFile: true });
      },
    );
  }

  async renameNode(nodeId: string, newName: string): Promise<void> {
    await this.writeLocalAndQueue(
      () => this.cache.renameNode(nodeId, newName),
      (ops) => {
        enqueueUpsertManifestNode(ops, nodeId);
      },
    );
  }

  async deleteNode(nodeId: string): Promise<void> {
    await this.writeLocalAndQueue(
      async () => {
        const deleted = await this.collectDeletedSubtree(nodeId);
        await this.cache.deleteNode(nodeId);
        return deleted;
      },
      (ops, deleted) => {
        enqueueDeleteManifestNode(ops, nodeId, deleted);
      },
    );
  }

  async moveNode(nodeId: string, newParentId: string | null): Promise<void> {
    await this.writeLocalAndQueue(
      () => this.cache.moveNode(nodeId, newParentId),
      (ops) => {
        enqueueUpsertManifestNode(ops, nodeId);
      },
    );
  }

  async setTags(nodeId: string, tags: string[]): Promise<void> {
    await this.writeLocalAndQueue(
      () => this.cache.setTags(nodeId, tags),
      (ops) => {
        enqueueUpsertManifestNode(ops, nodeId);
      },
    );
  }

  async addTag(nodeId: string, tag: string): Promise<void> {
    await this.writeLocalAndQueue(
      () => this.cache.addTag(nodeId, tag),
      (ops) => {
        enqueueUpsertManifestNode(ops, nodeId);
      },
    );
  }

  async removeTag(nodeId: string, tag: string): Promise<void> {
    await this.writeLocalAndQueue(
      () => this.cache.removeTag(nodeId, tag),
      (ops) => {
        enqueueUpsertManifestNode(ops, nodeId);
      },
    );
  }

  async getRevealPath(nodeId: VFSNodeId): Promise<string | null> {
    return this.cache.getRevealPath(nodeId);
  }

  async getStoredAbsolutePath(nodeId: VFSNodeId): Promise<string | null> {
    return this.cache.getStoredAbsolutePath(nodeId);
  }

  async getCustomColors(): Promise<string[]> {
    return this.cache.getCustomColors();
  }

  async addCustomColor(color: string): Promise<string[]> {
    return this.writeLocalAndQueue(
      () => this.cache.addCustomColor(color),
      (ops) => {
        enqueueCustomColorsSync(ops);
      },
    );
  }

  async removeCustomColor(color: string): Promise<string[]> {
    return this.writeLocalAndQueue(
      () => this.cache.removeCustomColor(color),
      (ops) => {
        enqueueCustomColorsSync(ops);
      },
    );
  }

  async getRegistryTags(): Promise<string[]> {
    return this.cache.getRegistryTags();
  }

  async addRegistryTags(tags: string[]): Promise<string[]> {
    return this.writeLocalAndQueue(
      () => this.cache.addRegistryTags(tags),
      (ops) => {
        enqueueTagRegistrySync(ops);
      },
    );
  }

  async removeRegistryTag(tag: string): Promise<string[]> {
    return this.writeLocalAndQueue(
      () => this.cache.removeRegistryTag(tag),
      (ops) => {
        enqueueTagRegistrySync(ops);
      },
    );
  }

  // Tri-state return contract, relied on by enqueuePushNote/checkRawConflicts/
  // applyRawFilePush:
  //   undefined -> not a raw file (canvas/non-file); skip conflict check entirely
  //   null      -> raw file whose base content is empty (computeRevision(empty))
  //   string    -> raw file base content hash
  // `undefined` (no check) and `null` (empty base) are distinct and must not be
  // conflated.
  private async getRawFileBaseRevision(
    nodeId: VFSNodeId,
  ): Promise<string | null | undefined> {
    const node = await this.cache.getNode(nodeId);
    if (!node || node.type !== 'file' || node.fileType === 'mcanvas') {
      return undefined;
    }
    return computeRevision(await this.cache.readFileBytes(nodeId));
  }

  private async getOrCreateVersionHistoryRoot(): Promise<VFSNodeId> {
    return this.writeLocalAndQueue(
      () =>
        this.cache.applyManifestMutation(
          'Create version history root',
          (manifest) => ensureVersionHistoryRoot(manifest, Date.now()),
        ),
      (ops, rootId) => {
        enqueueUpsertManifestNode(ops, rootId);
      },
    );
  }

  private async enforceFileVersionLimit(nodeId: VFSNodeId): Promise<void> {
    const versions = await this.listFileVersions(nodeId);
    const expired = versions.slice(VERSION_HISTORY_MAX_PER_FILE);
    for (const version of expired) {
      await this.deleteNode(version.id);
    }
  }

  async openSession(nodeId: VFSNodeId): Promise<NoteSession> {
    logger.debug('Opening cached repository local session', {
      repositoryKind: this.kind,
      nodeId,
      pendingOps: this.outbox.length,
    });
    const session = await NoteSession.open(nodeId, this);
    void this.pullOpenSessionUpdates(session).catch((error) => {
      logger.error('Failed to pull open cached session updates', error, {
        repositoryKind: this.kind,
        nodeId,
      });
    });
    return session;
  }

  private async pullOpenSessionUpdates(session: NoteSession): Promise<void> {
    await this.tryPullRemoteNoteIntoCache(session.id);
    await session.pull();
  }

  async loadDocument(nodeId: VFSNodeId): Promise<YjsSyncSnapshot> {
    return this.cache.loadDocument(nodeId);
  }

  async pullUpdates(
    nodeId: VFSNodeId,
    stateVector?: Uint8Array | null,
  ): Promise<YjsSyncSnapshot> {
    return this.cache.pullUpdates(nodeId, stateVector);
  }

  async pushUpdates(
    nodeId: VFSNodeId,
    update: Uint8Array,
    options: YjsSyncPushOptions,
  ): Promise<YjsSyncPushResult> {
    return this.withLocalStateLock(async () => {
      const result = await this.cache.pushUpdates(nodeId, update, options);
      if (result.accepted && result.changed) {
        await this.outbox.mutate((ops) => {
          enqueuePushNote(ops, nodeId);
        });
        logger.debug('Queued cached note push for remote sync', {
          repositoryKind: this.kind,
          nodeId,
          updateByteLength: update.byteLength,
          pendingOps: this.outbox.length,
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
    await this.remote.batchManifestWrites(() => this.flushPerOpImpl());
  }

  private async flushPerOpImpl(): Promise<void> {
    let pendingOps = await this.withLocalStateLock(async () => {
      await this.outbox.load();
      return this.outbox.length;
    });
    logger.debug('Flushing cached repository pending ops', {
      repositoryKind: this.kind,
      pendingOps,
      outboxPath: this.outboxPath(),
    });

    while (true) {
      const pending = await this.withLocalStateLock(() =>
        this.outbox.peekHead(),
      );
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
        const didRemove = await this.outbox.removeHeadIfUnchanged(pending.op);
        if (!didRemove) {
          logger.debug(
            'Leaving applied cached pending op queued because the head op changed during remote sync',
            {
              repositoryKind: this.kind,
              opKind: pending.op.kind,
              nodeId: 'nodeId' in pending.op ? pending.op.nodeId : null,
              pendingOps: this.outbox.length,
            },
          );
          this.updateRuntimeStatus({
            online: true,
            pendingRemoteWrites: this.outbox.length,
            lastRemoteSyncAt: Date.now(),
            lastError: null,
          });
          return false;
        }

        this.updateRuntimeStatus({
          online: true,
          pendingRemoteWrites: this.outbox.length,
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
      await this.outbox.load();
      return this.outbox.length;
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
      case 'sync-tag-registry':
        await this.applyTagRegistrySync();
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

  private async applyTagRegistrySync(): Promise<void> {
    // Cache is the source of truth — overwriting remote is what lets deletes
    // propagate (a merge-only strategy could never remove).
    const cacheTags = await this.withLocalStateLock(() =>
      this.cache.getRegistryTags(),
    );
    await this.remote.applyManifestMutation(
      'Sync tag registry',
      (remoteManifest) => {
        remoteManifest.tagRegistry = [...cacheTags];
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
        applyCachedManifestUpsert(
          remoteManifest,
          cacheSnapshot.manifest,
          nodeId,
        );
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

      if (op.replaceFile) {
        return {
          kind: 'replace-file' as const,
          node,
          bytes: await this.cache.readFileBytes(nodeId),
        };
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
    if (localState.kind === 'replace-file') {
      await this.applyFileReplace(node, localState.bytes);
      return;
    }

    if (node.fileType !== 'mcanvas') {
      await this.applyRawFilePush(
        op,
        node,
        localState.kind === 'raw-file' ? localState.bytes : null,
      );
      return;
    }

    if (localState.kind !== 'canvas-note') {
      return;
    }

    await this.applyCanvasNotePush(nodeId, localState.snapshot);
  }

  private async applyFileReplace(
    node: VFSFileNode,
    bytes: Uint8Array | null,
  ): Promise<void> {
    if (!bytes) {
      throw new Error(`Missing cached bytes for ${node.id}.`);
    }

    await this.remote.writeFileBytes(node.id, bytes);
    logger.debug('Applied cached file replacement to remote', {
      repositoryKind: this.kind,
      nodeId: node.id,
      fileType: node.fileType,
      byteLength: bytes.byteLength,
    });
  }

  private async applyRawFilePush(
    op: Extract<PendingOp, { kind: 'push-note' }>,
    node: VFSFileNode,
    bytes: Uint8Array | null,
  ): Promise<void> {
    const nodeId = op.nodeId;
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
  }

  private async applyCanvasNotePush(
    nodeId: VFSNodeId,
    localSnapshot: YjsSyncSnapshot,
  ): Promise<void> {
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

  private async tryPullRemoteNoteIntoCache(nodeId: VFSNodeId): Promise<void> {
    try {
      await withAsyncKeyedMutex(this.remoteSyncMutexKey(), async () => {
        await this.pullRemoteNoteIntoCache(nodeId);
      });
    } catch (error) {
      const statusError =
        error instanceof Error ? error : new Error(String(error));
      this.updateRuntimeStatus({
        ...(statusError instanceof RemoteNoteCacheMergeError
          ? {}
          : { online: false }),
        lastError: statusError,
      });
      logger.error('Failed to pull remote note into cache', error, {
        repositoryKind: this.kind,
        nodeId,
      });
    }
  }

  private async pullRemoteNoteIntoCache(nodeId: VFSNodeId): Promise<void> {
    const baseStateVector = await this.withLocalStateLock(async () => {
      await this.outbox.load();
      if (this.outbox.recoveryError) {
        return null;
      }
      if (this.hasPendingFileReplacement(nodeId)) {
        logger.debug(
          'Skipped pulling remote note into cache because a file replacement is pending',
          {
            repositoryKind: this.kind,
            nodeId,
          },
        );
        return null;
      }

      const node = await this.cache.getNode(nodeId);
      if (!node || node.type !== 'file' || node.fileType !== 'mcanvas') {
        return null;
      }

      return (await this.cache.loadDocument(nodeId)).stateVector;
    });

    if (!baseStateVector) {
      return;
    }

    const remoteSnapshot = await this.remote.pullUpdates(
      nodeId,
      baseStateVector,
    );

    const remoteUpdate = remoteSnapshot.update;

    if (!remoteUpdate || remoteUpdate.byteLength === 0) {
      this.updateRuntimeStatus({
        online: true,
        lastRemoteSyncAt: Date.now(),
        lastError: null,
      });
      return;
    }

    const appliedRemoteUpdate = await this.withLocalStateLock(async () => {
      await this.outbox.load();
      if (this.outbox.recoveryError) {
        return false;
      }
      if (this.hasPendingFileReplacement(nodeId)) {
        logger.debug(
          'Skipped applying remote note update because a file replacement is pending',
          {
            repositoryKind: this.kind,
            nodeId,
          },
        );
        return false;
      }

      const node = await this.cache.getNode(nodeId);
      if (!node || node.type !== 'file' || node.fileType !== 'mcanvas') {
        return false;
      }

      const currentSnapshot = await this.cache.loadDocument(nodeId);
      const result = await this.cache.pushUpdates(nodeId, remoteUpdate, {
        baseRevision: currentSnapshot.revision,
        localStateVector: currentSnapshot.stateVector,
      });

      if (!result.accepted) {
        throw new RemoteNoteCacheMergeError(nodeId);
      }
      return true;
    });

    this.updateRuntimeStatus({
      online: true,
      lastRemoteSyncAt: Date.now(),
      lastError: null,
    });
    if (appliedRemoteUpdate) {
      logger.debug('Pulled remote note into cache', {
        repositoryKind: this.kind,
        nodeId,
        updateByteLength: remoteUpdate.byteLength,
      });
    }
  }

  private hasPendingFileReplacement(nodeId: VFSNodeId): boolean {
    return this.outbox
      .snapshotOps()
      .some(
        (op) =>
          op.kind === 'push-note' && op.nodeId === nodeId && op.replaceFile,
      );
  }

  private async createRawFileConflictCopy(
    localNode: VFSFileNode,
    localBytes: Uint8Array,
    remoteBytes: Uint8Array | null,
  ): Promise<void> {
    const remoteNode = await this.remote.getNode(localNode.id);
    const originalRemoteNode =
      remoteNode?.type === 'file' ? structuredClone(remoteNode) : null;
    const conflictId: VFSNodeId = createNodeId();
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

  private outboxPath(): string {
    return this.outbox.path;
  }

  private remoteSyncMutexKey(): string {
    return `${this.outboxPath()}::remote-sync`;
  }

  private async withLocalStateLock<T>(operation: () => Promise<T>): Promise<T> {
    return withAsyncKeyedMutex(this.outboxPath(), operation);
  }

  private async syncCacheFromRemote(): Promise<void> {
    const remoteSnapshot = await this.remote.exportSnapshot();

    await this.withLocalStateLock(async () => {
      await this.outbox.load();
      const cacheSnapshot = await this.cache.exportSnapshot();
      logger.debug('Syncing cache from remote snapshot', {
        repositoryKind: this.kind,
        pendingOps: this.outbox.length,
        cacheNodeCount: Object.keys(cacheSnapshot.manifest.nodes).length,
        cacheNoteCount: Object.keys(cacheSnapshot.notes).length,
        remoteNodeCount: Object.keys(remoteSnapshot.manifest.nodes).length,
        remoteNoteCount: Object.keys(remoteSnapshot.notes).length,
      });

      if (this.outbox.recoveryError) {
        logger.error(
          'Skipped replacing cache from remote because cached repository outbox requires recovery',
          this.outbox.recoveryError,
          {
            repositoryKind: this.kind,
            outboxPath: this.outboxPath(),
          },
        );
        return;
      }

      if (this.outbox.length !== 0) {
        logger.debug(
          'Skipped replacing cache from remote because local pending ops exist',
          {
            repositoryKind: this.kind,
            pendingOps: this.outbox.length,
          },
        );
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
    // Single shared choke point for recording sync errors. Fire sync_failed
    // only when a real error is newly recorded (non-null and not the same
    // object already on record), so the multiple callers that route their
    // errors through here don't double-fire.
    if (patch.lastError && patch.lastError !== this.runtimeStatus.lastError) {
      const error = patch.lastError;
      const errorType =
        error instanceof RemoteNoteCacheMergeError ? 'conflict' : 'other';
      trackEvent('sync_failed', {
        error_type: errorType,
        error_message: error.message.slice(0, 200),
      });
    }
    this.runtimeStatus = { ...this.runtimeStatus, ...patch };
    const snapshot = this.getRuntimeStatus();
    for (const listener of this.statusListeners) {
      listener(snapshot);
    }
  }
}
