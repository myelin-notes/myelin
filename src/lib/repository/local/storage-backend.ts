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
import type {
  FileType,
  RepositoryStats,
  RepositoryTag,
  VFSFileNode,
  VFSFolderNode,
  VFSNode,
} from '../types';

interface VFSManifest {
  version: number;
  children: string[];
  nodes: Record<string, VFSNode>;
}

function generateId(): string {
  return crypto.randomUUID();
}

const CURRENT_MANIFEST_VERSION = 1;
const MANIFEST_PATH = 'manifest.json';
const FILES_DIR = 'files';
const FILE_EXT = '.myelin';

export class LocalStorageBackend {
  private manifest: VFSManifest | null = null;

  async getNode(nodeId: string): Promise<VFSNode | null> {
    const manifest = await this.loadManifest();
    return manifest.nodes[nodeId] ?? null;
  }

  async listDirectory(
    folderId: string | null,
  ): Promise<[VFSFolderNode[], VFSFileNode[]]> {
    const manifest = await this.loadManifest();
    const children = this.getChildren(manifest, folderId);

    const folders: VFSFolderNode[] = [];
    const files: VFSFileNode[] = [];

    for (const node of children) {
      if (node.type === 'folder') {
        folders.push(node);
      } else {
        files.push(node);
      }
    }

    return [folders, files];
  }

  async getFolderChain(folderId: string | null): Promise<VFSFolderNode[]> {
    const manifest = await this.loadManifest();
    if (folderId === null) {
      return [];
    }

    const chain: VFSFolderNode[] = [];
    let current: VFSNode | undefined = manifest.nodes[folderId];
    while (current && current.type === 'folder') {
      chain.unshift(current);
      if (current.parentId === null) {
        break;
      }
      current = manifest.nodes[current.parentId];
    }

    return chain;
  }

  async searchNodes(query: string): Promise<VFSNode[]> {
    const manifest = await this.loadManifest();
    const q = query.toLowerCase();

    return Object.values(manifest.nodes).filter(
      (node) =>
        node.name.toLowerCase().includes(q) ||
        node.tags.some((tag) => tag.toLowerCase().includes(q)),
    );
  }

  async getNodesByAnyTag(tags: string[]): Promise<VFSNode[]> {
    const manifest = await this.loadManifest();
    const tagSet = new Set(tags);
    return Object.values(manifest.nodes).filter((node) =>
      node.tags.some((tag) => tagSet.has(tag)),
    );
  }

  async listTags(): Promise<RepositoryTag[]> {
    const manifest = await this.loadManifest();
    const counts = new Map<string, number>();

    for (const node of Object.values(manifest.nodes)) {
      for (const tag of node.tags) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }

    return Array.from(counts.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count);
  }

  async getStats(): Promise<RepositoryStats> {
    const manifest = await this.loadManifest();
    let totalFiles = 0;
    let totalFolders = 0;
    const tagSet = new Set<string>();

    for (const node of Object.values(manifest.nodes)) {
      if (node.type === 'file') {
        totalFiles++;
      } else {
        totalFolders++;
      }

      for (const tag of node.tags) {
        tagSet.add(tag);
      }
    }

    return {
      totalFiles,
      totalFolders,
      totalTags: tagSet.size,
    };
  }

  async getRecentFiles(limit: number = 3): Promise<VFSFileNode[]> {
    const manifest = await this.loadManifest();
    return Object.values(manifest.nodes)
      .filter((node): node is VFSFileNode => node.type === 'file')
      .sort((a, b) => b.modifiedAt - a.modifiedAt)
      .slice(0, limit);
  }

  async getUniqueFileName(
    baseName: string,
    parentId: string | null,
  ): Promise<string> {
    const manifest = await this.loadManifest();
    const children = this.getChildren(manifest, parentId);
    const names = new Set(children.map((node) => node.name));

    if (!names.has(baseName)) {
      return baseName;
    }

    let counter = 1;
    while (names.has(`${baseName} ${counter}`)) {
      counter++;
    }

    return `${baseName} ${counter}`;
  }

  async createFolder(name: string, parentId: string | null): Promise<string> {
    const manifest = await this.loadManifest();
    const id = generateId();
    const now = Date.now();

    manifest.nodes[id] = {
      id,
      name,
      type: 'folder',
      parentId,
      children: [],
      tags: [],
      createdAt: now,
      modifiedAt: now,
    };

    this.addChild(manifest, parentId, id);
    await this.saveManifest(manifest);
    return id;
  }

  async createFile(
    name: string,
    fileType: FileType,
    parentId: string | null,
  ): Promise<string> {
    const manifest = await this.loadManifest();
    const id = generateId();

    const filePath = await join(FILES_DIR, `${id}${FILE_EXT}`);
    const file = await open(filePath, {
      write: true,
      create: true,
      baseDir: BaseDirectory.AppData,
    });
    await file.close();

    const now = Date.now();
    manifest.nodes[id] = {
      id,
      name,
      type: 'file',
      fileType,
      parentId,
      tags: [],
      createdAt: now,
      modifiedAt: now,
    };

    this.addChild(manifest, parentId, id);
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
    const node = manifest.nodes[nodeId];
    if (!node) {
      return;
    }

    this.removeChild(manifest, node.parentId, nodeId);

    const toDelete: string[] = [];
    const collect = (id: string) => {
      toDelete.push(id);
      const current = manifest.nodes[id];
      if (current && current.type === 'folder') {
        for (const childId of current.children) {
          collect(childId);
        }
      }
    };

    collect(nodeId);

    for (const id of toDelete) {
      const current = manifest.nodes[id];
      if (current && current.type === 'file') {
        await this.deleteNoteData(id);
        await ThumbnailCache.remove(id);
      }

      delete manifest.nodes[id];
    }

    await this.saveManifest(manifest);
  }

  async moveNode(nodeId: string, newParentId: string | null): Promise<void> {
    const manifest = await this.loadManifest();
    const node = manifest.nodes[nodeId];
    if (!node || node.parentId === newParentId) {
      return;
    }

    if (newParentId !== null) {
      const newParent = manifest.nodes[newParentId];
      if (!newParent || newParent.type !== 'folder') {
        return;
      }

      if (node.type === 'folder') {
        let checkId: string | null = newParentId;
        while (checkId !== null) {
          if (checkId === nodeId) {
            return;
          }
          const current: VFSNode | undefined = manifest.nodes[checkId];
          checkId = current?.parentId ?? null;
        }
      }
    }

    this.removeChild(manifest, node.parentId, nodeId);
    node.parentId = newParentId;
    node.modifiedAt = Date.now();
    this.addChild(manifest, newParentId, nodeId);
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

  async loadNoteData(nodeId: string): Promise<Uint8Array | null> {
    const manifest = await this.loadManifest();
    const node = manifest.nodes[nodeId];
    if (!node || node.type !== 'file') {
      return null;
    }

    const filePath = await join(FILES_DIR, `${nodeId}${FILE_EXT}`);
    if (!(await exists(filePath, { baseDir: BaseDirectory.AppData }))) {
      return null;
    }

    const data = await readFile(filePath, { baseDir: BaseDirectory.AppData });
    return data.length > 0 ? data : null;
  }

  async saveNoteData(nodeId: string, data: Uint8Array): Promise<void> {
    const manifest = await this.loadManifest();
    const node = manifest.nodes[nodeId];
    if (!node || node.type !== 'file' || data.byteLength === 0) {
      return;
    }

    if (!(await exists(FILES_DIR, { baseDir: BaseDirectory.AppData }))) {
      await mkdir(FILES_DIR, { baseDir: BaseDirectory.AppData });
    }

    const filePath = await join(FILES_DIR, `${nodeId}${FILE_EXT}`);
    await writeFile(filePath, data, {
      baseDir: BaseDirectory.AppData,
    });

    node.modifiedAt = Date.now();
    await this.saveManifest(manifest);
  }

  async getDiskPath(nodeId: string): Promise<string | null> {
    const manifest = await this.loadManifest();
    const node = manifest.nodes[nodeId];
    if (!node || node.type !== 'file') {
      return null;
    }

    return join(await appDataDir(), FILES_DIR, `${nodeId}${FILE_EXT}`);
  }

  private async ensureDirs(): Promise<void> {
    if (!(await exists('', { baseDir: BaseDirectory.AppData }))) {
      await mkdir('', { baseDir: BaseDirectory.AppData });
    }
    if (!(await exists(FILES_DIR, { baseDir: BaseDirectory.AppData }))) {
      await mkdir(FILES_DIR, { baseDir: BaseDirectory.AppData });
    }
  }

  // biome-ignore lint/suspicious/noExplicitAny: migration handles arbitrary legacy formats
  private migrate(parsed: any): VFSManifest {
    const now = Date.now();
    // biome-ignore lint/suspicious/noExplicitAny: legacy node shape is unknown
    for (const node of Object.values(parsed.nodes) as any[]) {
      if (node.createdAt == null) {
        node.createdAt = now;
      }
      if (node.modifiedAt == null) {
        node.modifiedAt = now;
      }
    }
    return parsed as VFSManifest;
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
      const parsed = JSON.parse(text);
      this.manifest = this.migrate(parsed);
      await this.saveManifest(this.manifest);
      return this.manifest;
    }

    const manifest: VFSManifest = {
      version: CURRENT_MANIFEST_VERSION,
      children: [],
      nodes: {},
    };
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

  private getChildren(
    manifest: VFSManifest,
    folderId: string | null,
  ): VFSNode[] {
    return this.getChildrenIds(manifest, folderId)
      .map((id) => manifest.nodes[id])
      .filter(Boolean);
  }

  private getChildrenIds(
    manifest: VFSManifest,
    folderId: string | null,
  ): string[] {
    if (folderId === null) {
      return manifest.children;
    }

    const folder = manifest.nodes[folderId];
    if (!folder || folder.type !== 'folder') {
      return [];
    }

    return folder.children;
  }

  private addChild(
    manifest: VFSManifest,
    parentId: string | null,
    childId: string,
  ): void {
    if (parentId === null) {
      manifest.children.push(childId);
      return;
    }

    const parent = manifest.nodes[parentId];
    if (parent && parent.type === 'folder') {
      parent.children.push(childId);
    }
  }

  private removeChild(
    manifest: VFSManifest,
    parentId: string | null,
    childId: string,
  ): void {
    if (parentId === null) {
      manifest.children = manifest.children.filter((id) => id !== childId);
      return;
    }

    const parent = manifest.nodes[parentId];
    if (parent && parent.type === 'folder') {
      parent.children = parent.children.filter((id) => id !== childId);
    }
  }

  private async deleteNoteData(nodeId: string): Promise<void> {
    const filePath = await join(FILES_DIR, `${nodeId}${FILE_EXT}`);
    if (await exists(filePath, { baseDir: BaseDirectory.AppData })) {
      await remove(filePath, { baseDir: BaseDirectory.AppData });
    }
  }
}
