import * as Y from 'yjs';
import { appDataDir, join } from '@tauri-apps/api/path';
import {
  BaseDirectory,
  exists,
  mkdir,
  open,
  readFile,
  readTextFile,
  remove,
  writeFile,
  writeTextFile,
} from '@tauri-apps/plugin-fs';
import { ThumbnailCache } from '@/lib/thumbnail-cache';
import { NoteSession } from '../session';
import type {
  YjsSyncPushOptions,
  YjsSyncPushResult,
  YjsSyncSnapshot,
  YjsSyncTarget,
} from '../types';
import type { RepositoryLifecycle } from './config';
import {
  addChild,
  computeRevision,
  createDocFromBytes,
  createEmptyManifest,
  createFileNode,
  createFolderNode,
  createNodeId,
  deleteNodeFromManifest,
  FILES_DIR,
  getFolderChain,
  getNodesByAnyTag,
  getNoteFileName,
  getRecentFiles,
  getStats,
  getUniqueFileName,
  listDirectoryNodes,
  listTags,
  MANIFEST_PATH,
  migrateManifest,
  moveNodeInManifest,
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

export class LocalRepository
  implements Repository, YjsSyncTarget, RepositoryLifecycle
{
  public readonly kind = 'local-storage';
  public readonly capabilities: RepositoryCapabilities = {
    polling: false,
    liveSync: false,
  };

  private manifest: VFSManifest | null = null;

  async initialize(): Promise<void> {
    await this.loadManifest();
  }

  async refresh(): Promise<void> {
    this.manifest = null;
    await this.loadManifest();
  }

  async flushPending(): Promise<void> {}

  async dispose(): Promise<void> {}

  async getNode(nodeId: string): Promise<VFSNode | null> {
    const manifest = await this.loadManifest();
    return manifest.nodes[nodeId] ?? null;
  }

  async listDirectory(
    folderId: string | null,
  ): Promise<[VFSFolderNode[], VFSFileNode[]]> {
    const manifest = await this.loadManifest();
    return listDirectoryNodes(manifest, folderId);
  }

  async getFolderChain(folderId: string | null): Promise<VFSFolderNode[]> {
    const manifest = await this.loadManifest();
    return getFolderChain(manifest, folderId);
  }

  async searchNodes(query: string): Promise<VFSNode[]> {
    const manifest = await this.loadManifest();
    return searchNodes(manifest, query);
  }

  async getNodesByAnyTag(tags: string[]): Promise<VFSNode[]> {
    const manifest = await this.loadManifest();
    return getNodesByAnyTag(manifest, tags);
  }

  async listTags(): Promise<RepositoryTag[]> {
    const manifest = await this.loadManifest();
    return listTags(manifest);
  }

  async getStats(): Promise<RepositoryStats> {
    const manifest = await this.loadManifest();
    return getStats(manifest);
  }

  async getRecentFiles(limit: number = 3): Promise<VFSFileNode[]> {
    const manifest = await this.loadManifest();
    return getRecentFiles(manifest, limit);
  }

  async getUniqueFileName(
    baseName: string,
    parentId: string | null,
  ): Promise<string> {
    const manifest = await this.loadManifest();
    return getUniqueFileName(manifest, baseName, parentId);
  }

  async createFolder(name: string, parentId: string | null): Promise<string> {
    const manifest = await this.loadManifest();
    const id = createNodeId();
    const now = Date.now();

    manifest.nodes[id] = createFolderNode(id, name, parentId, now);

    addChild(manifest, parentId, id);
    await this.saveManifest(manifest);
    return id;
  }

  async createFile(
    name: string,
    fileType: FileType,
    parentId: string | null,
  ): Promise<string> {
    const manifest = await this.loadManifest();
    const id = createNodeId();

    const filePath = await join(FILES_DIR, getNoteFileName(id));
    const file = await open(filePath, {
      write: true,
      create: true,
      baseDir: BaseDirectory.AppData,
    });
    await file.close();

    const now = Date.now();
    manifest.nodes[id] = createFileNode(id, name, fileType, parentId, now);

    addChild(manifest, parentId, id);
    await this.saveManifest(manifest);
    return id;
  }

  async renameNode(nodeId: string, newName: string): Promise<void> {
    const manifest = await this.loadManifest();
    const node = manifest.nodes[nodeId];
    if (!node) {
      return;
    }

    node.name = newName;
    node.modifiedAt = Date.now();
    await this.saveManifest(manifest);
  }

  async deleteNode(nodeId: string): Promise<void> {
    const manifest = await this.loadManifest();
    const deletedFileIds = deleteNodeFromManifest(manifest, nodeId);

    for (const fileId of deletedFileIds) {
      await this.deleteNoteData(fileId);
      await ThumbnailCache.remove(fileId);
    }

    await this.saveManifest(manifest);
  }

  async moveNode(nodeId: string, newParentId: string | null): Promise<void> {
    const manifest = await this.loadManifest();
    moveNodeInManifest(manifest, nodeId, newParentId);
    await this.saveManifest(manifest);
  }

  async setTags(nodeId: string, tags: string[]): Promise<void> {
    const manifest = await this.loadManifest();
    const node = manifest.nodes[nodeId];
    if (!node) {
      return;
    }

    node.tags = tags;
    node.modifiedAt = Date.now();
    await this.saveManifest(manifest);
  }

  async addTag(nodeId: string, tag: string): Promise<void> {
    const manifest = await this.loadManifest();
    const node = manifest.nodes[nodeId];
    if (!node || node.tags.includes(tag)) {
      return;
    }

    manifest.nodes[nodeId] = {
      ...node,
      tags: [...node.tags, tag],
      modifiedAt: Date.now(),
    };
    await this.saveManifest(manifest);
  }

  async removeTag(nodeId: string, tag: string): Promise<void> {
    const manifest = await this.loadManifest();
    const node = manifest.nodes[nodeId];
    if (!node) {
      return;
    }

    manifest.nodes[nodeId] = {
      ...node,
      tags: node.tags.filter((currentTag) => currentTag !== tag),
      modifiedAt: Date.now(),
    };
    await this.saveManifest(manifest);
  }

  async openSession(nodeId: string): Promise<NoteSession> {
    return NoteSession.open(nodeId, this);
  }

  async getRevealPath(nodeId: string): Promise<string | null> {
    const manifest = await this.loadManifest();
    const node = manifest.nodes[nodeId];
    if (!node || node.type !== 'file') {
      return null;
    }

    return join(await appDataDir(), FILES_DIR, getNoteFileName(nodeId));
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
    await this.saveNoteData(nodeId, mergedBytes);

    const revision = await computeRevision(mergedBytes);
    return {
      accepted: true,
      remoteUpdate: null,
      stateVector: Y.encodeStateVector(remote.doc),
      revision,
      update: mergedBytes,
    };
  }

  private async loadNoteData(nodeId: string): Promise<Uint8Array | null> {
    const manifest = await this.loadManifest();
    const node = manifest.nodes[nodeId];
    if (!node || node.type !== 'file') {
      return null;
    }

    const filePath = await join(FILES_DIR, getNoteFileName(nodeId));
    if (!(await exists(filePath, { baseDir: BaseDirectory.AppData }))) {
      return null;
    }

    const data = await readFile(filePath, { baseDir: BaseDirectory.AppData });
    return data.length > 0 ? data : null;
  }

  private async saveNoteData(nodeId: string, data: Uint8Array): Promise<void> {
    const manifest = await this.loadManifest();
    const node = manifest.nodes[nodeId];
    if (!node || node.type !== 'file' || data.byteLength === 0) {
      return;
    }

    if (!(await exists(FILES_DIR, { baseDir: BaseDirectory.AppData }))) {
      await mkdir(FILES_DIR, { baseDir: BaseDirectory.AppData });
    }

    const filePath = await join(FILES_DIR, getNoteFileName(nodeId));
    await writeFile(filePath, data, {
      baseDir: BaseDirectory.AppData,
    });

    node.modifiedAt = Date.now();
    await this.saveManifest(manifest);
  }

  private async ensureDirs(): Promise<void> {
    if (!(await exists('', { baseDir: BaseDirectory.AppData }))) {
      await mkdir('', { baseDir: BaseDirectory.AppData });
    }
    if (!(await exists(FILES_DIR, { baseDir: BaseDirectory.AppData }))) {
      await mkdir(FILES_DIR, { baseDir: BaseDirectory.AppData });
    }
  }

  private async loadManifest(): Promise<VFSManifest> {
    if (this.manifest) {
      return this.manifest;
    }

    await this.ensureDirs();

    if (await exists(MANIFEST_PATH, { baseDir: BaseDirectory.AppData })) {
      const text = await readTextFile(MANIFEST_PATH, {
        baseDir: BaseDirectory.AppData,
      });
      const parsed = JSON.parse(text) as VFSManifest;
      this.manifest = migrateManifest(parsed);
      await this.saveManifest(this.manifest);
      return this.manifest;
    }

    const manifest = createEmptyManifest();
    await this.saveManifest(manifest);
    this.manifest = manifest;
    return manifest;
  }

  private async saveManifest(manifest: VFSManifest): Promise<void> {
    this.manifest = manifest;
    await writeTextFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2), {
      baseDir: BaseDirectory.AppData,
    });
  }

  private async deleteNoteData(nodeId: string): Promise<void> {
    const filePath = await join(FILES_DIR, getNoteFileName(nodeId));
    if (await exists(filePath, { baseDir: BaseDirectory.AppData })) {
      await remove(filePath, { baseDir: BaseDirectory.AppData });
    }
  }

  private async readYjsSyncState(nodeId: string): Promise<{
    bytes: Uint8Array | null;
    doc: Y.Doc;
    stateVector: Uint8Array;
    revision: string | null;
  }> {
    const bytes = await this.loadNoteData(nodeId);
    const doc = createDocFromBytes(bytes);
    return {
      bytes,
      doc,
      stateVector: Y.encodeStateVector(doc),
      revision: await computeRevision(bytes),
    };
  }
}
