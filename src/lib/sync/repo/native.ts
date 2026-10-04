import {
  NODES_DELETED_EVENT,
  type NodesDeletedDetail,
} from '@myelin/editor/events';
import { removeThumbnail } from '@myelin/editor/thumbnails';
import { Logger } from '@myelin/shared/logger';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { SearchIndex } from '@/lib/search';
import type {
  NativeDocumentChange,
  NativeDocumentSnapshot,
  NativeDocumentWriteResult,
} from '../native-document-target';
import { NoteSession } from '../session';
import { MAX_PEN_PRESETS, type RepositoryRuntimeStatus } from './config';
import type {
  MetadataPatch,
  NativeDocumentWrite,
  NativeOperationRequests,
  NativeOperationResults,
  NativeRevision,
  OneNoteImportRequest,
  OneNoteImportResult,
  UpdateDocumentOperation,
  WriteFileOperation,
} from './native-operations';
import { noteContentIndex } from './note-content-index';
import {
  addChild,
  createFileNode,
  createFolderNode,
  createNodeId,
  createNodeSearchIndex,
  deleteNodeFromManifest,
  getBacklinks,
  getChildrenIds,
  getFileVersionNodes,
  getFolderChain,
  getNodesByAnyTag,
  getNodesByExactName,
  getNoteGraph,
  getRecentFiles,
  getStats,
  getUniqueFileName,
  listDirectoryNodes,
  listHierarchicalTags,
  listTags,
  moveNodeInManifest,
  normalizeCustomColor,
  searchNodeResults,
  toFileVersion,
  type VFSManifest,
} from './shared';
import { expandTagWithAncestors, normalizeTagInput } from './tag-hierarchy';
import type {
  CreateFileOptions,
  CustomColorTool,
  FileImportSource,
  FileType,
  FileVersion,
  NodeSearchResult,
  NoteBacklink,
  NoteIndexItem,
  PenPreset,
  PenPresetChanges,
  RenameReferencesRequest,
  RenameReferencesResult,
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
} from './types';

export interface MetadataTargets {
  nodes?: string[];
  settings?: boolean;
}

interface NativeStatus extends Omit<RepositoryRuntimeStatus, 'lastError'> {
  repositoryId: string;
  lastError: string | null;
}

interface DocumentEvent {
  repositoryId: string;
  nodeId: string;
  updateBase64?: string;
  origin: 'local' | 'peer' | 'repository';
  generation: string;
  replacement: boolean;
}

interface DataEvent {
  repositoryId: string;
  changed: string[];
  deleted: string[];
}

interface AuthEvent {
  repositoryId: string;
  credentialId: string;
  requestId: string;
  forceRefresh: boolean;
}

export type NativeRepositorySource =
  | { kind: 'github'; owner: string; repo: string; branch: string }
  | { kind: 'google-drive'; folderId: string };

export type NativeRepositoryOptions = {
  capabilities: RepositoryCapabilities;
  storageRoot: string;
} & (
  | {
      kind: 'local-storage';
      source: null;
      credentialId?: never;
      getToken?: never;
    }
  | {
      kind: 'github' | 'google-drive';
      source: NativeRepositorySource;
      credentialId: string;
      getToken: (forceRefresh: boolean) => Promise<string>;
    }
);

const logger = new Logger('NativeRepository');

function encode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(binary);
}

function decode(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

// Announce deleted files so the tab layer can close tabs bound to them. Guarded
// for non-DOM contexts (tests, background workers) where `window` is absent.
function emitNodesDeleted(ids: VFSNodeId[]): void {
  if (ids.length === 0 || typeof window === 'undefined') {
    return;
  }
  const detail: NodesDeletedDetail = { ids };
  window.dispatchEvent(new CustomEvent(NODES_DELETED_EVENT, { detail }));
}

export class NativeRepository implements Repository {
  readonly capabilities: RepositoryCapabilities;
  readonly kind: string;
  private handle = '';
  private initializing: Promise<void> | null = null;
  private disposed = false;
  private readonly unlisteners: UnlistenFn[] = [];
  private nativeVersion = -1;

  constructor(private readonly backend: NativeRepositoryOptions) {
    this.kind = backend.kind;
    this.capabilities = backend.capabilities;
  }

  get nativeRepositoryHandle(): string {
    return this.handle;
  }
  private get repositoryId(): string {
    return this.backend.storageRoot || 'local';
  }

  initialize(): Promise<void> {
    this.initializing ??= this.open();
    return this.initializing;
  }

  private async open(): Promise<void> {
    try {
      this.unlisteners.push(
        await listen<NativeStatus>('repository-status', ({ payload }) => {
          if (payload.repositoryId === this.repositoryId && !this.disposed) {
            this.applyStatus(payload);
          }
        }),
      );
      this.unlisteners.push(
        await listen<DataEvent>('repository-data', ({ payload }) => {
          if (payload.repositoryId === this.repositoryId && !this.disposed) {
            void this.onData(payload).catch((error) =>
              logger.error('Could not refresh native repository index', error),
            );
          }
        }),
      );
      this.unlisteners.push(
        await listen<AuthEvent>('repository-auth-request', ({ payload }) => {
          if (
            payload.repositoryId !== this.repositoryId ||
            !this.backend.source ||
            payload.credentialId !== this.backend.credentialId ||
            this.disposed
          ) {
            return;
          }
          void this.backend.getToken(payload.forceRefresh).then(
            (token) =>
              invoke('repository_auth_response', {
                requestId: payload.requestId,
                token,
              }),
            (error) =>
              invoke('repository_auth_response', {
                requestId: payload.requestId,
                error: String(error),
              }),
          );
        }),
      );
      const token =
        (await this.backend.getToken?.(false).catch(() => '')) ?? '';
      const source = this.backend.source
        ? { ...this.backend.source, token }
        : null;
      const opened = await invoke<{ handle: string; status: NativeStatus }>(
        'repository_open',
        {
          request: {
            storageRoot: this.backend.storageRoot,
            credentialId: this.backend.credentialId ?? '',
            source,
          },
        },
      );
      this.handle = opened.handle;
      if (this.disposed) {
        await invoke('repository_release', { handle: this.handle });
        return;
      }
      this.applyStatus(opened.status);
      noteContentIndex.reconcile(this);
    } catch (error) {
      for (const unlisten of this.unlisteners.splice(0)) {
        unlisten();
      }
      throw error;
    }
  }

  private applyStatus(status: NativeStatus): void {
    const dataVersion =
      this.getRuntimeStatus().dataVersion +
      (status.dataVersion !== this.nativeVersion ? 1 : 0);
    this.nativeVersion = status.dataVersion;
    this.updateRuntimeStatus({
      online: status.online,
      pendingRemoteWrites: status.pendingRemoteWrites,
      lastRemoteSyncAt: status.lastRemoteSyncAt,
      dataVersion,
      lastError: status.lastError ? new Error(status.lastError) : null,
    });
  }

  private async onData(data: DataEvent): Promise<void> {
    for (const id of data.deleted) {
      noteContentIndex.remove(this, id);
      await removeThumbnail(id);
    }
    if (data.deleted.length && typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent(NODES_DELETED_EVENT, { detail: { ids: data.deleted } }),
      );
    }
    if (!data.changed.length) {
      return;
    }
    const { manifest } = await this.loadMetadataImpl();
    for (const id of data.changed) {
      const node = manifest.nodes[id];
      if (node?.type !== 'file' || node.fileType !== 'mcanvas' || node.system) {
        noteContentIndex.remove(this, id);
        continue;
      }
      noteContentIndex.invalidate(this, id);
      const path = await this.getStoredAbsolutePath(id);
      if (path) {
        noteContentIndex.queueSaved(this, id, path);
      }
    }
  }

  private async operation<K extends keyof NativeOperationRequests>(
    operation: NativeOperationRequests[K] & { kind: K },
  ): Promise<NativeOperationResults[K]> {
    await this.initialize();
    if (this.disposed || !this.handle) {
      throw new Error('Repository is closed');
    }
    return invoke<NativeOperationResults[K]>('repository_operation', {
      handle: this.handle,
      operation,
    });
  }

  protected loadMetadataImpl(): Promise<{
    manifest: VFSManifest;
    revision: string;
  }> {
    return this.operation({ kind: 'manifest' });
  }
  protected async saveMetadataImpl(
    patch: MetadataPatch,
    revision: string | null,
  ): Promise<string> {
    const result = await this.operation({
      kind: 'save-metadata',
      patch,
      revision: revision ?? '',
    });
    return result.revision;
  }
  protected isConflictError(error: unknown): boolean {
    return String(error).includes('Native metadata conflict');
  }
  protected metadataMaxRetries(): number {
    return 4;
  }
  protected async loadFileBytes(
    nodeId: VFSNodeId,
  ): Promise<{ bytes: Uint8Array | null; revision: string | null }> {
    const node = await this.getNode(nodeId);
    if (!node || node.type !== 'file') {
      return { bytes: null, revision: null };
    }
    const result = await this.operation({ kind: 'read-file', nodeId });
    const bytes = decode(result.bytesBase64);
    return { bytes: bytes.length ? bytes : null, revision: result.revision };
  }
  private writeBytes(
    operation: WriteFileOperation,
    bytes: Uint8Array,
  ): Promise<NativeRevision>;
  private writeBytes(
    operation: UpdateDocumentOperation,
    bytes: Uint8Array,
  ): Promise<NativeDocumentWrite>;
  private async writeBytes(
    operation: WriteFileOperation | UpdateDocumentOperation,
    bytes: Uint8Array,
  ): Promise<NativeRevision | NativeDocumentWrite> {
    const withBytes = (
      bytesBase64: string,
    ): WriteFileOperation | UpdateDocumentOperation =>
      operation.kind === 'write-file'
        ? { ...operation, bytesBase64 }
        : { ...operation, updateBase64: bytesBase64 };
    if (bytes.length <= 8192) {
      return this.operation(withBytes(encode(bytes)));
    }
    const transferId = crypto.randomUUID();
    try {
      for (let offset = 0; offset < bytes.length; offset += 8192) {
        await this.operation({
          kind: 'stage-bytes',
          transferId,
          offset,
          bytesBase64: encode(bytes.subarray(offset, offset + 8192)),
        });
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      return await this.operation({
        kind: 'finish-transfer',
        transferId,
        operation: withBytes(''),
      });
    } catch (error) {
      await this.operation({ kind: 'cancel-transfer', transferId }).catch(
        () => {},
      );
      throw error;
    }
  }

  protected async saveFileBytes(
    node: VFSFileNode,
    bytes: Uint8Array,
  ): Promise<string | null> {
    const result = await this.writeBytes(
      {
        kind: 'write-file',
        bytesBase64: '',
        node,
        replace: true,
        overwriteRemote: false,
      },
      bytes,
    );
    return result.revision;
  }
  protected async deleteFileBytes(
    nodeId: VFSNodeId,
    fileType?: FileType,
  ): Promise<void> {
    await this.operation({
      kind: 'delete-file',
      nodeId,
      fileType: fileType ?? null,
    });
  }
  async writeFileBytes(nodeId: VFSNodeId, bytes: Uint8Array): Promise<void> {
    const node = await this.getNode(nodeId);
    if (!node || node.type !== 'file') {
      throw new Error('Repository file is missing');
    }
    await this.saveFileBytes(node, bytes);
  }
  /** Publishes a new file only after its bytes are durable. */
  async createFile(
    name: string,
    fileType: FileType,
    parentId: VFSNodeId | null,
    bytes?: Uint8Array,
    options?: CreateFileOptions,
  ): Promise<VFSNodeId> {
    const node = createFileNode(
      createNodeId(),
      name,
      fileType,
      parentId,
      Date.now(),
      options?.system,
    );
    if (bytes !== undefined) {
      await this.saveFileBytes(node, bytes);
    }
    return this.publishFile(node);
  }
  async importFile(
    name: string,
    fileType: FileType,
    parentId: VFSNodeId | null,
    source: FileImportSource,
  ): Promise<VFSNodeId> {
    const node = createFileNode(
      createNodeId(),
      name,
      fileType,
      parentId,
      Date.now(),
    );
    await this.operation({ kind: 'import-file', node, source });
    return this.publishFile(node);
  }
  private async publishFile(node: VFSFileNode): Promise<VFSNodeId> {
    // Replays after manifest conflicts must reuse the already-written file's ID.
    await this.mutateMetadata(
      'Create file',
      { nodes: [node.id] },
      (manifest) => {
        manifest.nodes[node.id] = node;
        addChild(manifest, node.parentId, node.id);
      },
    );
    this.searchMetadataRevision++;
    return node.id;
  }
  importOneNote(request: OneNoteImportRequest): Promise<OneNoteImportResult> {
    return this.operation({ kind: 'import-one-note', ...request });
  }

  renameReferences(
    request: RenameReferencesRequest,
  ): Promise<RenameReferencesResult> {
    return this.operation({ kind: 'rename-references', ...request });
  }
  createFileVersionIfDue(
    nodeId: VFSNodeId,
    options: { force?: boolean } = {},
  ): Promise<FileVersion | null> {
    return this.operation({
      kind: 'create-file-version',
      nodeId,
      force: options.force ?? false,
    });
  }
  async restoreFileVersion(
    nodeId: VFSNodeId,
    versionId: VFSNodeId,
  ): Promise<void> {
    await this.operation({ kind: 'restore-file-version', nodeId, versionId });
  }
  getStoredAbsolutePath(nodeId: VFSNodeId): Promise<string | null> {
    return this.operation({ kind: 'path', nodeId });
  }
  getRevealPath(nodeId: VFSNodeId): Promise<string | null> {
    return this.getStoredAbsolutePath(nodeId);
  }
  async refresh(): Promise<void> {
    await this.initialize();
    await invoke('repository_sync', { handle: this.handle });
  }
  flushPending(): Promise<void> {
    return this.refresh();
  }
  async dispose(): Promise<void> {
    this.disposed = true;
    await this.initializing?.catch(() => undefined);
    for (const unlisten of this.unlisteners.splice(0)) {
      unlisten();
    }
    if (this.handle) {
      await invoke('repository_release', { handle: this.handle });
      this.handle = '';
    }
  }

  openSession(nodeId: VFSNodeId): Promise<NoteSession> {
    return NoteSession.open(nodeId, this);
  }

  loadDocument(nodeId: VFSNodeId): Promise<NativeDocumentSnapshot> {
    return this.pullUpdates(nodeId);
  }
  async pullUpdates(
    nodeId: VFSNodeId,
    stateVector?: Uint8Array | null,
  ): Promise<NativeDocumentSnapshot> {
    const result = await this.operation({
      kind: 'document',
      nodeId,
      stateVectorBase64: stateVector ? encode(stateVector) : null,
    });
    return {
      generation: result.generation,
      update: decode(result.updateBase64),
      stateVector: decode(result.stateVectorBase64),
      revision: result.revision,
    };
  }
  async persistDocumentUpdate(
    nodeId: string,
    update: Uint8Array,
    generation?: string,
    sourceSession?: string,
  ): Promise<NativeDocumentWriteResult> {
    const result = await this.writeBytes(
      {
        kind: 'update-document',
        updateBase64: '',
        nodeId,
        origin: 'local',
        generation: generation ?? null,
        sourceSession: sourceSession ?? null,
      },
      update,
    );
    return {
      accepted: result.accepted,
      changed: result.changed,
      stateVector: decode(result.stateVectorBase64),
      revision: result.revision,
    };
  }
  async flushDocument(nodeId: string): Promise<void> {
    await this.operation({ kind: 'checkpoint-document', nodeId });
  }
  async subscribeDocument(
    nodeId: string,
    listener: (change: NativeDocumentChange) => void,
    sessionId: string,
  ): Promise<() => Promise<void>> {
    await this.initialize();
    const unlisten = await listen<DocumentEvent>(
      `repository-document-${sessionId}`,
      ({ payload }) => {
        if (
          payload.repositoryId !== this.repositoryId ||
          payload.nodeId !== nodeId ||
          this.disposed
        ) {
          return;
        }
        listener({
          update: payload.updateBase64 ? decode(payload.updateBase64) : null,
          origin: payload.origin,
          generation: payload.generation,
          replacement: payload.replacement,
        });
      },
    );
    this.unlisteners.push(unlisten);
    try {
      await this.operation({ kind: 'subscribe', nodeId, sessionId });
    } catch (error) {
      unlisten();
      const index = this.unlisteners.indexOf(unlisten);
      if (index !== -1) {
        this.unlisteners.splice(index, 1);
      }
      throw error;
    }
    return async () => {
      const index = this.unlisteners.indexOf(unlisten);
      if (index !== -1) {
        unlisten();
        this.unlisteners.splice(index, 1);
      }
      if (!this.disposed) {
        await this.operation({ kind: 'unsubscribe', nodeId, sessionId });
      }
    };
  }

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

  // Reused across search-as-you-type so a keystroke burst doesn't rebuild a MiniSearch index.
  private nodeSearchCache: {
    manifest: VFSManifest;
    dataVersion: number;
    index: SearchIndex<VFSNode>;
  } | null = null;

  private searchMetadataRevision = 0;

  // While positive, manifest mutations accumulate on one held manifest and defer their save to the
  // outermost close.
  private metadataBatchDepth = 0;

  // Loaded once. Reads inside the batch see pending writes because they share this object.
  private metadataBatchLoad: Promise<{
    manifest: VFSManifest;
    revision: string | null;
  }> | null = null;

  // Replayed onto the manifest that wins the race if the flush hits a conflict — so mutators must
  // be replay-safe: ids and any values the caller kept are minted outside the mutator.
  private metadataBatchMutators: Array<{
    run: (manifest: VFSManifest) => void;
    targets: MetadataTargets;
  }> = [];

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

  // Reads inside `fn` observe the pending writes. For additive bulk work like imports: the batch
  // has no delete semantics, so callers must not delete nodes inside it. A throwing `fn` discards
  // the batch — nothing partial is saved.
  async batchMetadataWrites<T>(fn: () => Promise<T>): Promise<T> {
    this.metadataBatchDepth += 1;
    let succeeded = false;
    try {
      const result = await fn();
      succeeded = true;
      return result;
    } finally {
      this.metadataBatchDepth -= 1;
      if (this.metadataBatchDepth === 0) {
        const load = this.metadataBatchLoad;
        const mutators = this.metadataBatchMutators;
        this.metadataBatchLoad = null;
        this.metadataBatchMutators = [];
        // A read-only batch has nothing to save; a failed one is dropped so no partial manifest lands —
        // the caller's own rollback handles bytes already written.
        if (succeeded && load && mutators.length > 0) {
          const { manifest, revision } = await load;
          await this.flushBatchedMetadata(manifest, revision, mutators);
        }
      }
    }
  }

  // Conflicts retry like a single mutation: reload the manifest that won the race and replay the
  // whole batch onto it so neither side's writes are lost.
  private async flushBatchedMetadata(
    manifest: VFSManifest,
    revision: string | null,
    mutators: ReadonlyArray<{
      run: (manifest: VFSManifest) => void;
      targets: MetadataTargets;
    }>,
  ): Promise<void> {
    let pendingManifest = manifest;
    let pendingRevision = revision;
    const maxRetries = this.metadataMaxRetries();
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        await this.saveMetadataImpl(
          this.metadataPatch(
            pendingManifest,
            mutators.map((entry) => entry.targets),
          ),
          pendingRevision,
        );
        this.updateRuntimeStatus({
          dataVersion: this.runtimeStatus.dataVersion + 1,
        });
        return;
      } catch (error) {
        if (attempt >= maxRetries - 1 || !this.isConflictError(error)) {
          throw error;
        }
        const fresh = await this.loadMetadataImpl();
        for (const mutator of mutators) {
          mutator.run(fresh.manifest);
        }
        pendingManifest = fresh.manifest;
        pendingRevision = fresh.revision;
      }
    }
    throw new Error('Failed to import after retrying metadata conflicts.');
  }

  // Inside a batch this is the one held manifest, so reads and writes within the batch observe each
  // other's pending changes; outside a batch it delegates straight to `loadMetadataImpl`.
  protected async loadMetadata(): Promise<{
    manifest: VFSManifest;
    revision: string | null;
  }> {
    if (this.metadataBatchDepth === 0) {
      return this.loadMetadataImpl();
    }
    if (!this.metadataBatchLoad) {
      const load = this.loadMetadataImpl();
      this.metadataBatchLoad = load;
      // A failed load must not poison the batch's later reads.
      load.catch(() => {
        if (this.metadataBatchLoad === load) {
          this.metadataBatchLoad = null;
        }
      });
    }
    return this.metadataBatchLoad;
  }

  async removeNoteData(nodeId: VFSNodeId, fileType?: FileType): Promise<void> {
    await this.deleteFileBytes(nodeId, fileType);
  }

  protected updateRuntimeStatus(patch: Partial<RepositoryRuntimeStatus>): void {
    this.runtimeStatus = { ...this.runtimeStatus, ...patch };
    const snapshot = this.getRuntimeStatus();
    for (const listener of this.statusListeners) {
      listener(snapshot);
    }
  }

  async getNode(nodeId: string): Promise<VFSNode | null> {
    const { manifest } = await this.loadMetadata();
    return manifest.nodes[nodeId] ?? null;
  }

  async listDirectory(
    folderId: string | null,
  ): Promise<[VFSFolderNode[], VFSFileNode[]]> {
    const { manifest } = await this.loadMetadata();
    return listDirectoryNodes(manifest, folderId);
  }

  /** Child ids including system nodes, which `listDirectory` filters out. */
  async listChildIds(folderId: string | null): Promise<readonly string[]> {
    const { manifest } = await this.loadMetadata();
    return getChildrenIds(manifest, folderId);
  }

  async getFolderChain(folderId: string | null): Promise<VFSFolderNode[]> {
    const { manifest } = await this.loadMetadata();
    return getFolderChain(manifest, folderId);
  }

  async searchNodes(
    query: string,
    options: SearchNodesOptions = {},
  ): Promise<NodeSearchResult[]> {
    const { manifest } = await this.loadMetadata();
    if (noteContentIndex.isSource(this)) {
      try {
        return await noteContentIndex.search(
          manifest,
          this.searchMetadataRevision,
          query,
          options.limit,
        );
      } catch (error) {
        logger.error(
          'Search worker unavailable; using title and tag search',
          error,
        );
      }
    }
    const index = this.getNodeSearchIndex(manifest);
    return searchNodeResults(manifest, query, index).slice(0, options.limit);
  }

  // Rebuilt only when the manifest changes.
  private getNodeSearchIndex(manifest: VFSManifest): SearchIndex<VFSNode> {
    const cache = this.nodeSearchCache;
    if (
      cache &&
      cache.manifest === manifest &&
      cache.dataVersion === this.runtimeStatus.dataVersion
    ) {
      return cache.index;
    }
    const index = createNodeSearchIndex(manifest);
    this.nodeSearchCache = {
      manifest,
      dataVersion: this.runtimeStatus.dataVersion,
      index,
    };
    return index;
  }

  async getNodesByName(name: string): Promise<VFSNode[]> {
    const { manifest } = await this.loadMetadata();
    return getNodesByExactName(manifest, name);
  }

  async getNodesByAnyTag(
    tags: string[],
    folderId: VFSNodeId | null = null,
  ): Promise<VFSNode[]> {
    const { manifest } = await this.loadMetadata();
    return getNodesByAnyTag(manifest, tags, folderId);
  }

  async listTags(includeAncestors = false): Promise<RepositoryTag[]> {
    const { manifest } = await this.loadMetadata();
    return includeAncestors
      ? listHierarchicalTags(manifest)
      : listTags(manifest);
  }

  async getStats(): Promise<RepositoryStats> {
    const { manifest } = await this.loadMetadata();
    return getStats(manifest);
  }

  async getRecentFiles(limit: number = 3): Promise<VFSFileNode[]> {
    const { manifest } = await this.loadMetadata();
    return getRecentFiles(manifest, limit);
  }

  async getBacklinks(noteId: VFSNodeId): Promise<NoteBacklink[]> {
    const { manifest } = await this.loadMetadata();
    return getBacklinks(manifest, noteId);
  }

  async getNoteGraph(): Promise<RepositoryNoteGraph> {
    const { manifest } = await this.loadMetadata();
    return getNoteGraph(manifest);
  }

  async getUniqueFileName(
    baseName: string,
    parentId: string | null,
  ): Promise<string> {
    const { manifest } = await this.loadMetadata();
    return getUniqueFileName(manifest, baseName, parentId);
  }

  async createFolder(name: string, parentId: string | null): Promise<string> {
    // Minted outside the mutator so a batched flush that replays this mutation
    // after a conflict reuses the id the caller already received.
    const id = createNodeId();
    const now = Date.now();
    await this.mutateMetadata('Create folder', { nodes: [id] }, (manifest) => {
      manifest.nodes[id] = createFolderNode(id, name, parentId, now);
      addChild(manifest, parentId, id);
    });
    this.searchMetadataRevision++;
    return id;
  }

  async listFileVersions(nodeId: VFSNodeId): Promise<FileVersion[]> {
    const { manifest } = await this.loadMetadata();
    return getFileVersionNodes(manifest, nodeId).map(toFileVersion);
  }

  async readFileBytes(nodeId: VFSNodeId): Promise<Uint8Array | null> {
    const { bytes } = await this.loadFileBytes(nodeId);
    return bytes ? new Uint8Array(bytes) : null;
  }

  async renameNode(nodeId: string, newName: string): Promise<void> {
    await this.mutateMetadata(
      'Rename node',
      { nodes: [nodeId] },
      (manifest) => {
        const node = manifest.nodes[nodeId];
        if (!node) {
          return;
        }
        node.name = newName;
        node.modifiedAt = Date.now();
      },
    );
    this.searchMetadataRevision++;
  }

  async deleteNode(nodeId: string): Promise<void> {
    const targets = { nodes: [] as string[] };
    const deletedFiles = await this.mutateMetadata(
      'Delete node',
      targets,
      (manifest) => deleteNodeFromManifest(manifest, nodeId, targets.nodes),
    );

    await Promise.all(
      deletedFiles.map(async (file) => {
        await this.deleteFileBytes(file.id, file.fileType);
        await removeThumbnail(file.id);
        if (file.fileType === 'mcanvas' && !file.system) {
          noteContentIndex.remove(this, file.id);
        }
      }),
    );
    this.searchMetadataRevision++;

    emitNodesDeleted(deletedFiles.map((file) => file.id));
  }

  async moveNode(nodeId: string, newParentId: string | null): Promise<void> {
    await this.mutateMetadata('Move node', { nodes: [nodeId] }, (manifest) => {
      moveNodeInManifest(manifest, nodeId, newParentId);
    });
  }

  async setTags(nodeId: string, tags: string[]): Promise<void> {
    await this.mutateMetadata(
      'Set node tags',
      { nodes: [nodeId] },
      (manifest) => {
        const node = manifest.nodes[nodeId];
        if (!node) {
          return;
        }
        node.tags = tags;
        node.modifiedAt = Date.now();
      },
    );
    this.searchMetadataRevision++;
  }

  async setFolderColor(nodeId: string, color: string | null): Promise<void> {
    const normalized = color === null ? null : normalizeCustomColor(color);
    if (color !== null && !normalized) {
      throw new Error(`Invalid color: ${color}`);
    }
    await this.mutateMetadata(
      'Set folder color',
      { nodes: [nodeId] },
      (manifest) => {
        const node = manifest.nodes[nodeId];
        if (node?.type !== 'folder') {
          return;
        }
        node.color = normalized ?? undefined;
        node.modifiedAt = Date.now();
      },
    );
  }

  async addTag(nodeId: string, tag: string): Promise<void> {
    await this.mutateMetadata(
      'Add node tag',
      { nodes: [nodeId] },
      (manifest) => {
        const node = manifest.nodes[nodeId];
        if (!node || node.tags.includes(tag)) {
          return;
        }
        manifest.nodes[nodeId] = {
          ...node,
          tags: [...node.tags, tag],
          modifiedAt: Date.now(),
        };
      },
    );
    this.searchMetadataRevision++;
  }

  async removeTag(nodeId: string, tag: string): Promise<void> {
    await this.mutateMetadata(
      'Remove node tag',
      { nodes: [nodeId] },
      (manifest) => {
        const node = manifest.nodes[nodeId];
        if (!node) {
          return;
        }
        manifest.nodes[nodeId] = {
          ...node,
          tags: node.tags.filter((currentTag) => currentTag !== tag),
          modifiedAt: Date.now(),
        };
      },
    );
    this.searchMetadataRevision++;
  }

  getNoteIndexSource(): object {
    return this;
  }

  async listNoteIndexItems(): Promise<NoteIndexItem[]> {
    const { manifest } = await this.loadMetadata();
    const items: NoteIndexItem[] = [];
    let inspected = 0;
    for (const id in manifest.nodes) {
      const node = manifest.nodes[id];
      if (node.type !== 'file' || node.fileType !== 'mcanvas' || node.system) {
        continue;
      }
      const path = await this.getStoredAbsolutePath(node.id);
      if (path) {
        items.push({ nodeId: node.id, path });
      }
      if (++inspected % 100 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
    return items;
  }

  async getCustomColors(tool: CustomColorTool): Promise<string[]> {
    const { manifest } = await this.loadMetadata();
    return [...manifest.colors[tool]];
  }

  async addCustomColor(
    color: string,
    tool: CustomColorTool,
  ): Promise<string[]> {
    const normalized = normalizeCustomColor(color);
    if (!normalized) {
      throw new Error(`Invalid color: ${color}`);
    }
    return this.mutateMetadata(
      'Add custom color',
      { settings: true },
      (manifest) => {
        const colors = manifest.colors[tool];
        if (!colors.includes(normalized)) {
          manifest.colors[tool] = [...colors, normalized];
        }
        return [...manifest.colors[tool]];
      },
    );
  }

  async removeCustomColor(
    color: string,
    tool: CustomColorTool,
  ): Promise<string[]> {
    const normalized = normalizeCustomColor(color);
    if (!normalized) {
      throw new Error(`Invalid color: ${color}`);
    }
    return this.mutateMetadata(
      'Remove custom color',
      { settings: true },
      (manifest) => {
        manifest.colors[tool] = manifest.colors[tool].filter(
          (c) => c !== normalized,
        );
        return [...manifest.colors[tool]];
      },
    );
  }

  async getPenPresets(): Promise<PenPreset[]> {
    const { manifest } = await this.loadMetadata();
    return manifest.penPresets.map((preset) => ({ ...preset }));
  }

  async addPenPreset(preset: Omit<PenPreset, 'id'>): Promise<PenPreset[]> {
    const normalized = normalizeCustomColor(preset.color);
    if (!normalized) {
      throw new Error(`Invalid color: ${preset.color}`);
    }
    return this.mutateMetadata(
      'Add pen preset',
      { settings: true },
      (manifest) => {
        const presets = manifest.penPresets;
        const duplicate = presets.some(
          (existing) =>
            existing.tool === preset.tool &&
            existing.color === normalized &&
            existing.size === preset.size,
        );
        if (!duplicate) {
          if (presets.length >= MAX_PEN_PRESETS) {
            throw new Error(
              `At most ${MAX_PEN_PRESETS} pen presets are allowed.`,
            );
          }
          manifest.penPresets = [
            ...presets,
            { ...preset, color: normalized, id: createNodeId() },
          ];
        }
        return manifest.penPresets.map((entry) => ({ ...entry }));
      },
    );
  }

  async updatePenPreset(
    id: string,
    changes: PenPresetChanges,
  ): Promise<PenPreset[]> {
    const normalized =
      changes.color === undefined ? null : normalizeCustomColor(changes.color);
    if (changes.color !== undefined && !normalized) {
      throw new Error(`Invalid color: ${changes.color}`);
    }
    return this.mutateMetadata(
      'Update pen preset',
      { settings: true },
      (manifest) => {
        manifest.penPresets = manifest.penPresets.map((preset) =>
          preset.id === id
            ? {
                ...preset,
                ...(normalized ? { color: normalized } : {}),
                ...(changes.size !== undefined ? { size: changes.size } : {}),
                ...(changes.inWheel !== undefined
                  ? { inWheel: changes.inWheel }
                  : {}),
              }
            : preset,
        );
        return manifest.penPresets.map((entry) => ({ ...entry }));
      },
    );
  }

  async reorderPenPresets(ids: readonly string[]): Promise<PenPreset[]> {
    return this.mutateMetadata(
      'Reorder pen presets',
      { settings: true },
      (manifest) => {
        const presetsById = new Map(
          manifest.penPresets.map((preset) => [preset.id, preset]),
        );
        if (
          ids.length !== presetsById.size ||
          new Set(ids).size !== ids.length ||
          ids.some((id) => !presetsById.has(id))
        ) {
          throw new Error(
            'Preset order must contain every preset exactly once.',
          );
        }
        manifest.penPresets = ids.map((id) => presetsById.get(id)!);
        return manifest.penPresets.map((preset) => ({ ...preset }));
      },
    );
  }

  async removePenPreset(id: string): Promise<PenPreset[]> {
    return this.mutateMetadata(
      'Remove pen preset',
      { settings: true },
      (manifest) => {
        manifest.penPresets = manifest.penPresets.filter(
          (preset) => preset.id !== id,
        );
        return manifest.penPresets.map((entry) => ({ ...entry }));
      },
    );
  }

  async getRegistryTags(): Promise<string[]> {
    const { manifest } = await this.loadMetadata();
    return [...manifest.tagRegistry];
  }

  async addRegistryTags(tags: string[]): Promise<string[]> {
    // Registering `a/b` also registers its ancestor `a`, so parent tags exist
    // as usable filters even before anything is attached to them.
    const normalized = tags
      .map(normalizeTagInput)
      .filter((tag) => tag.length > 0)
      .flatMap(expandTagWithAncestors);
    return this.mutateMetadata(
      'Add registry tags',
      { settings: true },
      (manifest) => {
        const next = new Set(manifest.tagRegistry);
        for (const tag of normalized) {
          next.add(tag);
        }
        manifest.tagRegistry = [...next];
        return [...manifest.tagRegistry];
      },
    );
  }

  async removeRegistryTag(tag: string): Promise<string[]> {
    return this.mutateMetadata(
      'Remove registry tag',
      { settings: true },
      (manifest) => {
        manifest.tagRegistry = manifest.tagRegistry.filter((t) => t !== tag);
        return [...manifest.tagRegistry];
      },
    );
  }

  private metadataPatch(
    manifest: VFSManifest,
    targets: readonly MetadataTargets[],
  ): MetadataPatch {
    const ids = new Set(targets.flatMap((target) => target.nodes ?? []));
    return {
      nodes: [...ids].flatMap((id) =>
        manifest.nodes[id]
          ? [
              {
                node: manifest.nodes[id],
                links: manifest.linksBySource[id] ?? [],
              },
            ]
          : [],
      ),
      deletedNodeIds: [...ids].filter((id) => !manifest.nodes[id]),
      settings: targets.some((target) => target.settings)
        ? {
            colors: manifest.colors,
            tagRegistry: manifest.tagRegistry,
            penPresets: manifest.penPresets,
          }
        : null,
    };
  }

  protected async mutateMetadata<T>(
    action: string,
    targets: MetadataTargets,
    mutator: (manifest: VFSManifest) => T,
  ): Promise<T> {
    if (this.metadataBatchDepth > 0) {
      // Apply to the held manifest and defer the save to the batch flush. The
      // mutator is captured so a conflicting flush can replay it.
      const { manifest } = await this.loadMetadata();
      const result = mutator(manifest);
      this.metadataBatchMutators.push({ run: mutator, targets });
      return result;
    }

    const maxRetries = this.metadataMaxRetries();
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const { manifest, revision } = await this.loadMetadataImpl();
      const result = mutator(manifest);

      try {
        await this.saveMetadataImpl(
          this.metadataPatch(manifest, [targets]),
          revision,
        );
        this.updateRuntimeStatus({
          dataVersion: this.runtimeStatus.dataVersion + 1,
        });
        return result;
      } catch (error) {
        if (attempt < maxRetries - 1 && this.isConflictError(error)) {
          continue;
        }
        throw error;
      }
    }

    throw new Error(
      `Failed to ${action.toLowerCase()} after retrying metadata conflicts.`,
    );
  }
}
