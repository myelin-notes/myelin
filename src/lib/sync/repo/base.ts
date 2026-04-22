import * as Y from 'yjs';
import { removeThumbnail } from '@/lib/thumbnails';
import { NoteSession } from '../session';
import type {
  YjsSyncPushOptions,
  YjsSyncPushResult,
  YjsSyncSnapshot,
  YjsSyncTarget,
} from '../types';
import type {
  RepositoryLifecycle,
  RepositoryRuntimeStatus,
  RepositoryStatusSource,
} from './config';
import {
  addChild,
  createDocFromBytes,
  createFileNode,
  createFolderNode,
  createNodeId,
  deleteNodeFromManifest,
  getFolderChain,
  getNodesByAnyTag,
  getRecentFiles,
  getStats,
  getUniqueFileName,
  listDirectoryNodes,
  listTags,
  moveNodeInManifest,
  normalizeCustomColor,
  type RepositorySnapshot,
  searchNodes,
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
  };
  private readonly statusListeners = new Set<
    (status: RepositoryRuntimeStatus) => void
  >();

  protected abstract loadManifestImpl(): Promise<{
    manifest: VFSManifest;
    revision: string | null;
  }>;

  protected abstract saveManifestImpl(
    manifest: VFSManifest,
    revision: string | null,
    action: string,
  ): Promise<string | null>;

  protected abstract loadNoteBytes(nodeId: string): Promise<{
    bytes: Uint8Array | null;
    revision: string | null;
  }>;

  protected abstract saveNoteBytes(
    nodeId: string,
    bytes: Uint8Array,
    revision: string | null,
    message: string,
  ): Promise<string | null>;

  protected abstract deleteNoteBytes(nodeId: string): Promise<void>;

  protected isConflictError(_error: unknown): boolean {
    return false;
  }

  protected manifestMaxRetries(): number {
    return 1;
  }

  protected async onFileCreated(_nodeId: string): Promise<void> {}

  protected async onNoteSaved(_nodeId: string): Promise<void> {}

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
    const { manifest } = await this.loadManifestImpl();
    const snapshotManifest = structuredClone(manifest);
    const fileNodes = Object.values(snapshotManifest.nodes).filter(
      (node): node is VFSFileNode => node.type === 'file',
    );

    const noteEntries = await Promise.all(
      fileNodes.map(async (node) => {
        const { bytes } = await this.loadNoteBytes(node.id);
        return [node.id, bytes ? new Uint8Array(bytes) : null] as const;
      }),
    );

    return {
      manifest: snapshotManifest,
      notes: Object.fromEntries(noteEntries),
    };
  }

  async applyManifestMutation<T>(
    action: string,
    mutator: (manifest: VFSManifest) => T,
  ): Promise<T> {
    return this.mutateManifest(action, mutator);
  }

  async removeNoteData(nodeId: string): Promise<void> {
    await this.deleteNoteBytes(nodeId);
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
    const { manifest } = await this.loadManifestImpl();
    return manifest.nodes[nodeId] ?? null;
  }

  async listDirectory(
    folderId: string | null,
  ): Promise<[VFSFolderNode[], VFSFileNode[]]> {
    const { manifest } = await this.loadManifestImpl();
    return listDirectoryNodes(manifest, folderId);
  }

  async getFolderChain(folderId: string | null): Promise<VFSFolderNode[]> {
    const { manifest } = await this.loadManifestImpl();
    return getFolderChain(manifest, folderId);
  }

  async searchNodes(query: string): Promise<VFSNode[]> {
    const { manifest } = await this.loadManifestImpl();
    return searchNodes(manifest, query);
  }

  async getNodesByAnyTag(tags: string[]): Promise<VFSNode[]> {
    const { manifest } = await this.loadManifestImpl();
    return getNodesByAnyTag(manifest, tags);
  }

  async listTags(): Promise<RepositoryTag[]> {
    const { manifest } = await this.loadManifestImpl();
    return listTags(manifest);
  }

  async getStats(): Promise<RepositoryStats> {
    const { manifest } = await this.loadManifestImpl();
    return getStats(manifest);
  }

  async getRecentFiles(limit: number = 3): Promise<VFSFileNode[]> {
    const { manifest } = await this.loadManifestImpl();
    return getRecentFiles(manifest, limit);
  }

  async getUniqueFileName(
    baseName: string,
    parentId: string | null,
  ): Promise<string> {
    const { manifest } = await this.loadManifestImpl();
    return getUniqueFileName(manifest, baseName, parentId);
  }

  async createFolder(name: string, parentId: string | null): Promise<string> {
    return this.mutateManifest('Create folder', (manifest) => {
      const id = createNodeId();
      const now = Date.now();
      manifest.nodes[id] = createFolderNode(id, name, parentId, now);
      addChild(manifest, parentId, id);
      return id;
    });
  }

  async createFile(
    name: string,
    fileType: FileType,
    parentId: string | null,
  ): Promise<string> {
    const id = await this.mutateManifest('Create file', (manifest) => {
      const newId = createNodeId();
      const now = Date.now();
      manifest.nodes[newId] = createFileNode(
        newId,
        name,
        fileType,
        parentId,
        now,
      );
      addChild(manifest, parentId, newId);
      return newId;
    });
    await this.onFileCreated(id);
    return id;
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
    const deletedFileIds = await this.mutateManifest(
      'Delete node',
      (manifest) => deleteNodeFromManifest(manifest, nodeId),
    );

    await Promise.all(
      deletedFileIds.map(async (fileId) => {
        await this.deleteNoteBytes(fileId);
        await removeThumbnail(fileId);
      }),
    );
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

  async getRevealPath(_nodeId: string): Promise<string | null> {
    return null;
  }

  async getCustomColors(): Promise<string[]> {
    const { manifest } = await this.loadManifestImpl();
    return [...manifest.customColors];
  }

  async addCustomColor(color: string): Promise<string[]> {
    const normalized = normalizeCustomColor(color);
    if (!normalized) {
      throw new Error(`Invalid color: ${color}`);
    }
    return this.mutateManifest('Add custom color', (manifest) => {
      if (!manifest.customColors.includes(normalized)) {
        manifest.customColors = [...manifest.customColors, normalized];
      }
      return [...manifest.customColors];
    });
  }

  async removeCustomColor(color: string): Promise<string[]> {
    const normalized = normalizeCustomColor(color);
    if (!normalized) {
      throw new Error(`Invalid color: ${color}`);
    }
    return this.mutateManifest('Remove custom color', (manifest) => {
      manifest.customColors = manifest.customColors.filter(
        (c) => c !== normalized,
      );
      return [...manifest.customColors];
    });
  }

  async openSession(nodeId: string): Promise<NoteSession> {
    return NoteSession.open(nodeId, this);
  }

  async loadDocument(nodeId: string): Promise<YjsSyncSnapshot> {
    const remote = await this.readYjsSyncState(nodeId);
    return {
      update: remote.bytes,
      stateVector: remote.stateVector,
      revision: remote.revision,
    };
  }

  async pullUpdates(
    nodeId: string,
    stateVector?: Uint8Array | null,
  ): Promise<YjsSyncSnapshot> {
    const remote = await this.readYjsSyncState(nodeId);
    return {
      update: stateVector
        ? Y.encodeStateAsUpdate(remote.doc, stateVector)
        : remote.bytes,
      stateVector: remote.stateVector,
      revision: remote.revision,
    };
  }

  async pushUpdates(
    nodeId: string,
    update: Uint8Array,
    options: YjsSyncPushOptions,
  ): Promise<YjsSyncPushResult> {
    const remote = await this.readYjsSyncState(nodeId);

    if (options.baseRevision !== remote.revision) {
      return {
        accepted: false,
        remoteUpdate: options.localStateVector
          ? Y.encodeStateAsUpdate(remote.doc, options.localStateVector)
          : remote.bytes,
        stateVector: remote.stateVector,
        revision: remote.revision,
        update: remote.bytes,
      };
    }

    if (update.byteLength > 0) {
      Y.applyUpdate(remote.doc, update);
    }

    const mergedBytes = Y.encodeStateAsUpdate(remote.doc);
    const revision = await this.saveNoteBytes(
      nodeId,
      mergedBytes,
      remote.revision,
      `Update note ${nodeId}`,
    );
    if (revision !== null) {
      await this.onNoteSaved(nodeId);
    }

    return {
      accepted: true,
      remoteUpdate: null,
      stateVector: Y.encodeStateVector(remote.doc),
      revision,
      update: mergedBytes,
    };
  }

  protected async mutateManifest<T>(
    action: string,
    mutator: (manifest: VFSManifest) => T,
  ): Promise<T> {
    const maxRetries = this.manifestMaxRetries();
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const { manifest, revision } = await this.loadManifestImpl();
      const result = mutator(manifest);

      try {
        await this.saveManifestImpl(manifest, revision, action);
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

  private async readYjsSyncState(nodeId: string): Promise<{
    bytes: Uint8Array | null;
    doc: Y.Doc;
    stateVector: Uint8Array;
    revision: string | null;
  }> {
    const { bytes, revision } = await this.loadNoteBytes(nodeId);
    const doc = createDocFromBytes(bytes);
    return {
      bytes,
      doc,
      stateVector: Y.encodeStateVector(doc),
      revision,
    };
  }
}
