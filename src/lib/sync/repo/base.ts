import * as Y from 'yjs';
import {
  NODES_DELETED_EVENT,
  type NodesDeletedDetail,
} from '@myelin/editor/events';
import { summarizeYDoc } from '@myelin/editor/note/state-summary';
import { getPlatform, type ReindexItem } from '@myelin/editor/platform';
import type {
  YjsSyncPushOptions,
  YjsSyncPushResult,
  YjsSyncSnapshot,
  YjsSyncTarget,
} from '@myelin/editor/sync/types';
import { removeThumbnail } from '@myelin/editor/thumbnails';
import { Logger } from '@myelin/shared/logger';
import type { SearchIndex } from '@/lib/search';
import { NoteSession } from '../session';
import type {
  RepositoryLifecycle,
  RepositoryRuntimeStatus,
  RepositoryStatusSource,
} from './config';
import { MAX_PEN_PRESETS } from './config';
import { extractStoredNoteLinks } from './note-link-index';
import {
  addChild,
  computeRevision,
  createDocFromBytes,
  createFileNode,
  createFolderNode,
  createNodeId,
  createNodeSearchIndex,
  deleteNodeFromManifest,
  ensureVersionHistoryRoot,
  getBacklinks,
  getChildrenIds,
  getFileVersionNodes,
  getFolderChain,
  getIndexCandidateFileNodes,
  getNodesByAnyTag,
  getNodesByExactName,
  getNoteGraph,
  getRecentFiles,
  getStats,
  getUniqueFileName,
  isFileVersionNode as isConcreteFileVersionNode,
  isIndexCandidateFileNode,
  listDirectoryNodes,
  listHierarchicalTags,
  listTags,
  moveNodeInManifest,
  normalizeCustomColor,
  type RepositorySnapshot,
  searchNodeResults,
  searchNodeResultsSemantically,
  setStoredNoteLinks,
  toFileVersion,
  VERSION_HISTORY_INTERVAL_MS,
  VERSION_HISTORY_MAX_PER_FILE,
  type VFSManifest,
} from './shared';
import { expandTagWithAncestors, normalizeTagInput } from './tag-hierarchy';
import type {
  CreateFileOptions,
  CustomColorTool,
  FileType,
  FileVersion,
  NodeSearchResult,
  NoteBacklink,
  PenPreset,
  PenPresetChanges,
  Repository,
  RepositoryCapabilities,
  RepositoryNoteGraph,
  RepositoryStats,
  RepositoryTag,
  SearchNodesOptions,
  StoredNoteLink,
  VFSFileNode,
  VFSFolderNode,
  VFSNode,
  VFSNodeId,
} from './types';

const logger = new Logger('BaseRepository');
const DEFAULT_SEMANTIC_SEARCH_LIMIT = 50;
const EMPTY_CONTENT: ReadonlyMap<VFSNodeId, string> = new Map();

// Announce deleted files so the tab layer can close tabs bound to them. Guarded
// for non-DOM contexts (tests, background workers) where `window` is absent.
function emitNodesDeleted(ids: VFSNodeId[]): void {
  if (ids.length === 0 || typeof window === 'undefined') {
    return;
  }
  const detail: NodesDeletedDetail = { ids };
  window.dispatchEvent(new CustomEvent(NODES_DELETED_EVENT, { detail }));
}

function byteArraysEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) {
    return false;
  }

  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }

  return true;
}

export abstract class BaseRepository
  implements
    Repository,
    YjsSyncTarget,
    RepositoryLifecycle,
    RepositoryStatusSource
{
  public abstract readonly kind: string;
  public abstract readonly capabilities: RepositoryCapabilities;

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

  // Reused across search-as-you-type so a keystroke burst doesn't rebuild a MiniSearch index over
  // the whole corpus each time. Keyed on the manifest reference, the mutation counter, and the
  // note-index content revision, so it rebuilds exactly when the searchable corpus changes.
  private nodeSearchCache: {
    manifest: VFSManifest;
    dataVersion: number;
    contentRevision: number;
    index: SearchIndex<VFSNode>;
  } | null = null;

  // While positive, manifest mutations accumulate on one held manifest and defer their save to the
  // outermost close.
  private manifestBatchDepth = 0;
  // Loaded once. Reads inside the batch see pending writes because they share this object.
  private manifestBatchLoad: Promise<{
    manifest: VFSManifest;
    revision: string | null;
  }> | null = null;
  // Replayed onto the manifest that wins the race if the flush hits a conflict — so mutators must
  // be replay-safe: ids and any values the caller kept are minted outside the mutator.
  private manifestBatchMutators: Array<(manifest: VFSManifest) => void> = [];

  protected abstract loadManifestImpl(): Promise<{
    manifest: VFSManifest;
    revision: string | null;
  }>;

  protected abstract saveManifestImpl(
    manifest: VFSManifest,
    revision: string | null,
    action: string,
  ): Promise<string | null>;

  protected abstract loadFileBytes(nodeId: VFSNodeId): Promise<{
    bytes: Uint8Array | null;
    revision: string | null;
  }>;

  protected abstract saveFileBytes(
    nodeId: VFSNodeId,
    bytes: Uint8Array,
    revision: string | null,
    message: string,
  ): Promise<string | null>;

  protected abstract deleteFileBytes(
    nodeId: VFSNodeId,
    fileType?: FileType,
  ): Promise<void>;

  protected isConflictError(_error: unknown): boolean {
    return false;
  }

  protected manifestMaxRetries(): number {
    return 1;
  }

  protected async onFileSaved(
    nodeId: VFSNodeId,
    links?: readonly StoredNoteLink[],
  ): Promise<void> {
    let candidateFileType: FileType | null = null;
    await this.mutateManifest('Touch file', (manifest) => {
      const node = manifest.nodes[nodeId];
      if (node && node.type === 'file') {
        node.modifiedAt = Date.now();
        // Offer non-system files to the engine; it decides by type what to index.
        // Version-history snapshots are system nodes and are never offered.
        if (isIndexCandidateFileNode(node)) {
          candidateFileType = node.fileType;
        }
        // Snapshots are system nodes; their links must not enter the graph.
        if (node.fileType === 'mcanvas' && !node.system && links) {
          setStoredNoteLinks(manifest, nodeId, links);
        }
      }
    });

    if (candidateFileType !== null) {
      const { noteIndex, handwriting } = getPlatform();
      if (noteIndex || handwriting) {
        const path = await this.getStoredAbsolutePath(nodeId);
        if (path) {
          noteIndex?.requestReindex(nodeId, path, candidateFileType);
          handwriting?.requestRecognize(nodeId, path, candidateFileType);
        }
      }
    }
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

  async exportSnapshot(): Promise<RepositorySnapshot> {
    const { manifest } = await this.loadManifest();
    const snapshotManifest = structuredClone(manifest);
    const fileNodes = Object.values(snapshotManifest.nodes).filter(
      (node): node is VFSFileNode => node.type === 'file',
    );

    const noteEntries = await Promise.all(
      fileNodes.map(async (node) => {
        const { bytes } = await this.loadFileBytes(node.id);
        return [node.id, bytes ? new Uint8Array(bytes) : null] as const;
      }),
    );

    return {
      manifest: snapshotManifest,
      notes: Object.fromEntries(noteEntries),
    };
  }

  // Reads inside `fn` observe the pending writes. For additive bulk work like imports: the batch
  // has no delete semantics, so callers must not delete nodes inside it. A throwing `fn` discards
  // the batch — nothing partial is saved.
  async batchManifestWrites<T>(fn: () => Promise<T>): Promise<T> {
    this.manifestBatchDepth += 1;
    let succeeded = false;
    try {
      const result = await fn();
      succeeded = true;
      return result;
    } finally {
      this.manifestBatchDepth -= 1;
      if (this.manifestBatchDepth === 0) {
        const load = this.manifestBatchLoad;
        const mutators = this.manifestBatchMutators;
        this.manifestBatchLoad = null;
        this.manifestBatchMutators = [];
        // A read-only batch has nothing to save; a failed one is dropped so no partial manifest lands —
        // the caller's own rollback handles bytes already written.
        if (succeeded && load && mutators.length > 0) {
          const { manifest, revision } = await load;
          await this.flushBatchedManifest(manifest, revision, mutators);
        }
      }
    }
  }

  // Conflicts retry like a single mutation: reload the manifest that won the race and replay the
  // whole batch onto it so neither side's writes are lost.
  private async flushBatchedManifest(
    manifest: VFSManifest,
    revision: string | null,
    mutators: ReadonlyArray<(manifest: VFSManifest) => void>,
  ): Promise<void> {
    let pendingManifest = manifest;
    let pendingRevision = revision;
    const maxRetries = this.manifestMaxRetries();
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        await this.saveManifestImpl(pendingManifest, pendingRevision, 'Import');
        this.updateRuntimeStatus({
          dataVersion: this.runtimeStatus.dataVersion + 1,
        });
        return;
      } catch (error) {
        if (attempt >= maxRetries - 1 || !this.isConflictError(error)) {
          throw error;
        }
        const fresh = await this.loadManifestImpl();
        for (const mutator of mutators) {
          mutator(fresh.manifest);
        }
        pendingManifest = fresh.manifest;
        pendingRevision = fresh.revision;
      }
    }
    throw new Error('Failed to import after retrying manifest conflicts.');
  }

  // Inside a batch this is the one held manifest, so reads and writes within the batch observe each
  // other's pending changes; outside a batch it delegates straight to `loadManifestImpl`.
  protected async loadManifest(): Promise<{
    manifest: VFSManifest;
    revision: string | null;
  }> {
    if (this.manifestBatchDepth === 0) {
      return this.loadManifestImpl();
    }
    if (!this.manifestBatchLoad) {
      const load = this.loadManifestImpl();
      this.manifestBatchLoad = load;
      // A failed load must not poison the batch's later reads.
      load.catch(() => {
        if (this.manifestBatchLoad === load) {
          this.manifestBatchLoad = null;
        }
      });
    }
    return this.manifestBatchLoad;
  }

  async applyManifestMutation<T>(
    action: string,
    mutator: (manifest: VFSManifest) => T,
  ): Promise<T> {
    return this.mutateManifest(action, mutator);
  }

  async removeNoteData(nodeId: VFSNodeId, fileType?: FileType): Promise<void> {
    await this.deleteFileBytes(nodeId, fileType);
  }

  async initialize(): Promise<void> {
    await this.loadManifestImpl();
  }

  async refresh(): Promise<void> {}

  async flushPending(): Promise<void> {}

  async dispose(): Promise<void> {}

  protected updateRuntimeStatus(patch: Partial<RepositoryRuntimeStatus>): void {
    this.runtimeStatus = { ...this.runtimeStatus, ...patch };
    const snapshot = this.getRuntimeStatus();
    for (const listener of this.statusListeners) {
      listener(snapshot);
    }
  }

  async getNode(nodeId: string): Promise<VFSNode | null> {
    const { manifest } = await this.loadManifest();
    return manifest.nodes[nodeId] ?? null;
  }

  async listDirectory(
    folderId: string | null,
  ): Promise<[VFSFolderNode[], VFSFileNode[]]> {
    const { manifest } = await this.loadManifest();
    return listDirectoryNodes(manifest, folderId);
  }

  /** Child ids including system nodes, which `listDirectory` filters out. */
  async listChildIds(folderId: string | null): Promise<readonly string[]> {
    const { manifest } = await this.loadManifest();
    return getChildrenIds(manifest, folderId);
  }

  async getFolderChain(folderId: string | null): Promise<VFSFolderNode[]> {
    const { manifest } = await this.loadManifest();
    return getFolderChain(manifest, folderId);
  }

  async searchNodes(
    query: string,
    options: SearchNodesOptions = {},
  ): Promise<NodeSearchResult[]> {
    const { manifest } = await this.loadManifest();
    const noteIndex = getPlatform().noteIndex;
    // Semantic search needs the index capability; fall back to name search.
    if (options.mode === 'semantic' && query.trim() && noteIndex) {
      const queryEmbedding = await noteIndex.embedSearchQuery(query);
      const limit = options.limit ?? DEFAULT_SEMANTIC_SEARCH_LIMIT;
      return searchNodeResultsSemantically(
        manifest,
        query,
        queryEmbedding,
        noteIndex.getContent(),
        noteIndex.getEmbeddings(),
      ).slice(0, limit);
    }
    const content = noteIndex?.getContent() ?? EMPTY_CONTENT;
    const index = this.getNodeSearchIndex(
      manifest,
      content,
      noteIndex ? noteIndex.contentRevision() : 0,
    );
    return searchNodeResults(manifest, query, content, index).slice(
      0,
      options.limit,
    );
  }

  // Rebuilt only when the searchable corpus (manifest nodes or indexed content) has changed.
  private getNodeSearchIndex(
    manifest: VFSManifest,
    content: ReadonlyMap<VFSNodeId, string>,
    contentRevision: number,
  ): SearchIndex<VFSNode> {
    const cache = this.nodeSearchCache;
    if (
      cache &&
      cache.manifest === manifest &&
      cache.dataVersion === this.runtimeStatus.dataVersion &&
      cache.contentRevision === contentRevision
    ) {
      return cache.index;
    }
    const index = createNodeSearchIndex(manifest, content);
    this.nodeSearchCache = {
      manifest,
      dataVersion: this.runtimeStatus.dataVersion,
      contentRevision,
      index,
    };
    return index;
  }

  async getNodesByName(name: string): Promise<VFSNode[]> {
    const { manifest } = await this.loadManifest();
    return getNodesByExactName(manifest, name);
  }

  async listIndexBackfillItems(): Promise<ReindexItem[]> {
    const { manifest } = await this.loadManifest();
    const items: ReindexItem[] = [];
    for (const node of getIndexCandidateFileNodes(manifest)) {
      const path = await this.getStoredAbsolutePath(node.id);
      if (path) {
        items.push({ nodeId: node.id, path, fileType: node.fileType });
      }
    }
    return items;
  }

  async getNodesByAnyTag(
    tags: string[],
    folderId: VFSNodeId | null = null,
  ): Promise<VFSNode[]> {
    const { manifest } = await this.loadManifest();
    return getNodesByAnyTag(manifest, tags, folderId);
  }

  async listTags(includeAncestors = false): Promise<RepositoryTag[]> {
    const { manifest } = await this.loadManifest();
    return includeAncestors
      ? listHierarchicalTags(manifest)
      : listTags(manifest);
  }

  async getStats(): Promise<RepositoryStats> {
    const { manifest } = await this.loadManifest();
    return getStats(manifest);
  }

  async getRecentFiles(limit: number = 3): Promise<VFSFileNode[]> {
    const { manifest } = await this.loadManifest();
    return getRecentFiles(manifest, limit);
  }

  async getBacklinks(noteId: VFSNodeId): Promise<NoteBacklink[]> {
    const { manifest } = await this.loadManifest();
    return getBacklinks(manifest, noteId);
  }

  async getNoteGraph(): Promise<RepositoryNoteGraph> {
    const { manifest } = await this.loadManifest();
    return getNoteGraph(manifest);
  }

  async getUniqueFileName(
    baseName: string,
    parentId: string | null,
  ): Promise<string> {
    const { manifest } = await this.loadManifest();
    return getUniqueFileName(manifest, baseName, parentId);
  }

  async createFolder(name: string, parentId: string | null): Promise<string> {
    // Minted outside the mutator so a batched flush that replays this mutation
    // after a conflict reuses the id the caller already received.
    const id = createNodeId();
    const now = Date.now();
    await this.mutateManifest('Create folder', (manifest) => {
      manifest.nodes[id] = createFolderNode(id, name, parentId, now);
      addChild(manifest, parentId, id);
    });
    return id;
  }

  async createFile(
    name: string,
    fileType: FileType,
    parentId: string | null,
    bytes?: Uint8Array,
    options?: CreateFileOptions,
  ): Promise<VFSNodeId> {
    // Minted outside the mutator so a batched flush that replays this mutation
    // after a conflict reuses the id the caller already received.
    const id = createNodeId();
    const now = Date.now();
    await this.mutateManifest('Create file', (manifest) => {
      manifest.nodes[id] = createFileNode(
        id,
        name,
        fileType,
        parentId,
        now,
        options?.system,
      );
      addChild(manifest, parentId, id);
    });
    if (bytes !== undefined) {
      await this.writeFileBytes(id, bytes);
    }
    return id;
  }

  async listFileVersions(nodeId: VFSNodeId): Promise<FileVersion[]> {
    const { manifest } = await this.loadManifest();
    return getFileVersionNodes(manifest, nodeId).map(toFileVersion);
  }

  async createFileVersionIfDue(
    nodeId: VFSNodeId,
    options: { force?: boolean } = {},
  ): Promise<FileVersion | null> {
    const node = await this.getNode(nodeId);
    if (!node || node.type !== 'file' || node.system) {
      return null;
    }

    const bytes = await this.readFileBytes(nodeId);
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

    const versionNode = await this.getNode(versionId);
    return isConcreteFileVersionNode(versionNode)
      ? toFileVersion(versionNode)
      : null;
  }

  async restoreFileVersion(
    nodeId: VFSNodeId,
    versionId: VFSNodeId,
  ): Promise<void> {
    const versionNode = await this.getNode(versionId);
    if (
      !isConcreteFileVersionNode(versionNode) ||
      versionNode.system.sourceFileId !== nodeId
    ) {
      throw new Error('Version does not belong to this file.');
    }

    const bytes = await this.readFileBytes(versionId);
    if (!bytes) {
      throw new Error('Version data is missing.');
    }
    const currentBytes = await this.readFileBytes(nodeId);
    const versionRevision = await computeRevision(bytes);
    if (
      currentBytes &&
      (await computeRevision(currentBytes)) === versionRevision
    ) {
      return;
    }
    await this.createFileVersionIfDue(nodeId, { force: true });
    await this.writeFileBytes(nodeId, bytes);
  }

  async readFileBytes(nodeId: VFSNodeId): Promise<Uint8Array | null> {
    const { bytes } = await this.loadFileBytes(nodeId);
    return bytes ? new Uint8Array(bytes) : null;
  }

  async writeFileBytes(nodeId: VFSNodeId, bytes: Uint8Array): Promise<void> {
    const { revision } = await this.loadFileBytes(nodeId);
    const links = await this.extractStoredNoteLinksForBytes(nodeId, bytes);
    const nextRevision = await this.saveFileBytes(
      nodeId,
      bytes,
      revision,
      `Update file ${nodeId}`,
    );
    if (nextRevision !== null) {
      await this.onFileSaved(nodeId, links);
    }
  }

  async renameNode(nodeId: string, newName: string): Promise<void> {
    await this.mutateManifest('Rename node', (manifest) => {
      const node = manifest.nodes[nodeId];
      if (!node) {
        return;
      }
      node.name = newName;
      node.modifiedAt = Date.now();
    });
  }

  async deleteNode(nodeId: string): Promise<void> {
    const deletedFiles = await this.mutateManifest('Delete node', (manifest) =>
      deleteNodeFromManifest(manifest, nodeId),
    );

    await Promise.all(
      deletedFiles.map(async (file) => {
        await this.deleteFileBytes(file.id, file.fileType);
        await removeThumbnail(file.id);
        await getPlatform().noteIndex?.removeIndex(file.id);
        await getPlatform().handwriting?.removeRecognition(file.id);
      }),
    );

    emitNodesDeleted(deletedFiles.map((file) => file.id));
  }

  async moveNode(nodeId: string, newParentId: string | null): Promise<void> {
    await this.mutateManifest('Move node', (manifest) => {
      moveNodeInManifest(manifest, nodeId, newParentId);
    });
  }

  async setTags(nodeId: string, tags: string[]): Promise<void> {
    await this.mutateManifest('Set node tags', (manifest) => {
      const node = manifest.nodes[nodeId];
      if (!node) {
        return;
      }
      node.tags = tags;
      node.modifiedAt = Date.now();
    });
  }

  async addTag(nodeId: string, tag: string): Promise<void> {
    await this.mutateManifest('Add node tag', (manifest) => {
      const node = manifest.nodes[nodeId];
      if (!node || node.tags.includes(tag)) {
        return;
      }
      manifest.nodes[nodeId] = {
        ...node,
        tags: [...node.tags, tag],
        modifiedAt: Date.now(),
      };
    });
  }

  async removeTag(nodeId: string, tag: string): Promise<void> {
    await this.mutateManifest('Remove node tag', (manifest) => {
      const node = manifest.nodes[nodeId];
      if (!node) {
        return;
      }
      manifest.nodes[nodeId] = {
        ...node,
        tags: node.tags.filter((currentTag) => currentTag !== tag),
        modifiedAt: Date.now(),
      };
    });
  }

  async getRevealPath(_nodeId: VFSNodeId): Promise<string | null> {
    return null;
  }

  async getStoredAbsolutePath(_nodeId: VFSNodeId): Promise<string | null> {
    return null;
  }

  async getCustomColors(tool: CustomColorTool): Promise<string[]> {
    const { manifest } = await this.loadManifest();
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
    return this.mutateManifest('Add custom color', (manifest) => {
      const colors = manifest.colors[tool];
      if (!colors.includes(normalized)) {
        manifest.colors[tool] = [...colors, normalized];
      }
      return [...manifest.colors[tool]];
    });
  }

  async removeCustomColor(
    color: string,
    tool: CustomColorTool,
  ): Promise<string[]> {
    const normalized = normalizeCustomColor(color);
    if (!normalized) {
      throw new Error(`Invalid color: ${color}`);
    }
    return this.mutateManifest('Remove custom color', (manifest) => {
      manifest.colors[tool] = manifest.colors[tool].filter(
        (c) => c !== normalized,
      );
      return [...manifest.colors[tool]];
    });
  }

  async getPenPresets(): Promise<PenPreset[]> {
    const { manifest } = await this.loadManifest();
    return manifest.penPresets.map((preset) => ({ ...preset }));
  }

  async addPenPreset(preset: Omit<PenPreset, 'id'>): Promise<PenPreset[]> {
    const normalized = normalizeCustomColor(preset.color);
    if (!normalized) {
      throw new Error(`Invalid color: ${preset.color}`);
    }
    return this.mutateManifest('Add pen preset', (manifest) => {
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
    });
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
    return this.mutateManifest('Update pen preset', (manifest) => {
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
    });
  }

  async removePenPreset(id: string): Promise<PenPreset[]> {
    return this.mutateManifest('Remove pen preset', (manifest) => {
      manifest.penPresets = manifest.penPresets.filter(
        (preset) => preset.id !== id,
      );
      return manifest.penPresets.map((entry) => ({ ...entry }));
    });
  }

  async getRegistryTags(): Promise<string[]> {
    const { manifest } = await this.loadManifest();
    return [...manifest.tagRegistry];
  }

  async addRegistryTags(tags: string[]): Promise<string[]> {
    // Registering `a/b` also registers its ancestor `a`, so parent tags exist
    // as usable filters even before anything is attached to them.
    const normalized = tags
      .map(normalizeTagInput)
      .filter((tag) => tag.length > 0)
      .flatMap(expandTagWithAncestors);
    return this.mutateManifest('Add registry tags', (manifest) => {
      const next = new Set(manifest.tagRegistry);
      for (const tag of normalized) {
        next.add(tag);
      }
      manifest.tagRegistry = [...next];
      return [...manifest.tagRegistry];
    });
  }

  async removeRegistryTag(tag: string): Promise<string[]> {
    return this.mutateManifest('Remove registry tag', (manifest) => {
      manifest.tagRegistry = manifest.tagRegistry.filter((t) => t !== tag);
      return [...manifest.tagRegistry];
    });
  }

  async openSession(nodeId: VFSNodeId): Promise<NoteSession> {
    logger.debug('Opening repository-backed note session', {
      repositoryKind: this.kind,
      nodeId,
    });
    return NoteSession.open(nodeId, this);
  }

  async loadDocument(nodeId: VFSNodeId): Promise<YjsSyncSnapshot> {
    const remote = await this.readYjsSyncState(nodeId);
    logger.debug('Loaded repository document snapshot', {
      repositoryKind: this.kind,
      nodeId,
      revision: remote.revision,
      byteLength: remote.bytes?.byteLength ?? 0,
      stateVectorByteLength: remote.stateVector.byteLength,
      ...summarizeYDoc(remote.doc),
    });
    return {
      update: remote.bytes,
      stateVector: remote.stateVector,
      revision: remote.revision,
    };
  }

  async pullUpdates(
    nodeId: VFSNodeId,
    stateVector?: Uint8Array | null,
  ): Promise<YjsSyncSnapshot> {
    const remote = await this.readYjsSyncState(nodeId);
    logger.debug('Pulled repository document snapshot', {
      repositoryKind: this.kind,
      nodeId,
      revision: remote.revision,
      requestedStateVectorByteLength: stateVector?.byteLength ?? 0,
      byteLength: remote.bytes?.byteLength ?? 0,
      stateVectorByteLength: remote.stateVector.byteLength,
      ...summarizeYDoc(remote.doc),
    });
    return {
      update: stateVector
        ? Y.encodeStateAsUpdate(remote.doc, stateVector)
        : remote.bytes,
      stateVector: remote.stateVector,
      revision: remote.revision,
    };
  }

  async pushUpdates(
    nodeId: VFSNodeId,
    update: Uint8Array,
    options: YjsSyncPushOptions,
  ): Promise<YjsSyncPushResult> {
    const remote = await this.readYjsSyncState(nodeId);
    logger.debug('Pushing repository document updates', {
      repositoryKind: this.kind,
      nodeId,
      baseRevision: options.baseRevision,
      remoteRevision: remote.revision,
      updateByteLength: update.byteLength,
      localStateVectorByteLength: options.localStateVector?.byteLength ?? 0,
      remoteStateVectorByteLength: remote.stateVector.byteLength,
      ...summarizeYDoc(remote.doc),
    });

    if (options.baseRevision !== remote.revision) {
      logger.debug(
        'Rejected repository document push because revision changed',
        {
          repositoryKind: this.kind,
          nodeId,
          baseRevision: options.baseRevision,
          remoteRevision: remote.revision,
          remoteStateVectorByteLength: remote.stateVector.byteLength,
          ...summarizeYDoc(remote.doc),
        },
      );
      return {
        accepted: false,
        changed: false,
        remoteUpdate: options.localStateVector
          ? Y.encodeStateAsUpdate(remote.doc, options.localStateVector)
          : remote.bytes,
        stateVector: remote.stateVector,
        revision: remote.revision,
        update: remote.bytes,
      };
    }

    const previousBytes = Y.encodeStateAsUpdate(remote.doc);
    if (update.byteLength > 0) {
      Y.applyUpdate(remote.doc, update);
    }
    const mergedBytes = Y.encodeStateAsUpdate(remote.doc);
    const stateVector = Y.encodeStateVector(remote.doc);

    if (byteArraysEqual(previousBytes, mergedBytes)) {
      logger.debug('Accepted no-op repository document push', {
        repositoryKind: this.kind,
        nodeId,
        revision: remote.revision,
        stateVectorByteLength: stateVector.byteLength,
        ...summarizeYDoc(remote.doc),
      });
      return {
        accepted: true,
        changed: false,
        remoteUpdate: null,
        stateVector,
        revision: remote.revision,
        update: remote.bytes,
      };
    }

    const links = extractStoredNoteLinks(remote.doc);
    const revision = await this.saveFileBytes(
      nodeId,
      mergedBytes,
      remote.revision,
      `Update note ${nodeId}`,
    );
    if (revision !== null) {
      await this.onFileSaved(nodeId, links);
    }

    logger.debug('Accepted repository document push', {
      repositoryKind: this.kind,
      nodeId,
      revision,
      stateVectorByteLength: stateVector.byteLength,
      ...summarizeYDoc(remote.doc),
    });

    return {
      accepted: true,
      changed: true,
      remoteUpdate: null,
      stateVector,
      revision,
      update: mergedBytes,
    };
  }

  protected async mutateManifest<T>(
    action: string,
    mutator: (manifest: VFSManifest) => T,
  ): Promise<T> {
    if (this.manifestBatchDepth > 0) {
      // Apply to the held manifest and defer the save to the batch flush. The
      // mutator is captured so a conflicting flush can replay it.
      const { manifest } = await this.loadManifest();
      const result = mutator(manifest);
      this.manifestBatchMutators.push(mutator);
      return result;
    }

    const maxRetries = this.manifestMaxRetries();
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const { manifest, revision } = await this.loadManifestImpl();
      const result = mutator(manifest);

      try {
        await this.saveManifestImpl(manifest, revision, action);
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
      `Failed to ${action.toLowerCase()} after retrying manifest conflicts.`,
    );
  }

  private async readYjsSyncState(nodeId: VFSNodeId): Promise<{
    bytes: Uint8Array | null;
    doc: Y.Doc;
    stateVector: Uint8Array;
    revision: string | null;
  }> {
    const node = await this.getNode(nodeId);
    if (node?.type === 'file' && node.fileType !== 'mcanvas') {
      throw new Error(`Cannot open ${node.fileType} files as canvas sessions.`);
    }

    const { bytes, revision } = await this.loadFileBytes(nodeId);
    const doc = createDocFromBytes(bytes);
    return {
      bytes,
      doc,
      stateVector: Y.encodeStateVector(doc),
      revision,
    };
  }

  private async extractStoredNoteLinksForBytes(
    nodeId: VFSNodeId,
    bytes: Uint8Array,
  ): Promise<StoredNoteLink[] | undefined> {
    const node = await this.getNode(nodeId);
    if (node?.type !== 'file' || node.fileType !== 'mcanvas') {
      return undefined;
    }

    return extractStoredNoteLinks(createDocFromBytes(bytes));
  }

  private async getOrCreateVersionHistoryRoot(): Promise<VFSNodeId> {
    return this.mutateManifest('Create version history root', (manifest) =>
      ensureVersionHistoryRoot(manifest, Date.now()),
    );
  }

  private async enforceFileVersionLimit(nodeId: VFSNodeId): Promise<void> {
    const versions = await this.listFileVersions(nodeId);
    const expired = versions.slice(VERSION_HISTORY_MAX_PER_FILE);
    for (const version of expired) {
      await this.deleteNode(version.id);
    }
  }
}
