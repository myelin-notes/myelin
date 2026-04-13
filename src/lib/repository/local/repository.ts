import type {
  FileType,
  Repository,
  RepositoryStats,
  RepositoryTag,
  VFSFileNode,
  VFSFolderNode,
  VFSNode,
} from '../types';
import type { LocalStorageBackend } from './storage-backend';

export class LocalRepository implements Repository {
  public readonly kind = 'local-storage';

  constructor(private readonly backend: LocalStorageBackend) {}

  async getNode(nodeId: string): Promise<VFSNode | null> {
    return this.backend.getNode(nodeId);
  }

  async listDirectory(
    folderId: string | null,
  ): Promise<[VFSFolderNode[], VFSFileNode[]]> {
    return this.backend.listDirectory(folderId);
  }

  async getFolderChain(folderId: string | null): Promise<VFSFolderNode[]> {
    return this.backend.getFolderChain(folderId);
  }

  async searchNodes(query: string): Promise<VFSNode[]> {
    return this.backend.searchNodes(query);
  }

  async getNodesByAnyTag(tags: string[]): Promise<VFSNode[]> {
    return this.backend.getNodesByAnyTag(tags);
  }

  async listTags(): Promise<RepositoryTag[]> {
    return this.backend.listTags();
  }

  async getStats(): Promise<RepositoryStats> {
    return this.backend.getStats();
  }

  async getRecentFiles(limit?: number): Promise<VFSFileNode[]> {
    return this.backend.getRecentFiles(limit);
  }

  async getUniqueFileName(
    baseName: string,
    parentId: string | null,
  ): Promise<string> {
    return this.backend.getUniqueFileName(baseName, parentId);
  }

  async createFolder(name: string, parentId: string | null): Promise<string> {
    return this.backend.createFolder(name, parentId);
  }

  async createFile(
    name: string,
    fileType: FileType,
    parentId: string | null,
  ): Promise<string> {
    return this.backend.createFile(name, fileType, parentId);
  }

  async renameNode(nodeId: string, newName: string): Promise<void> {
    await this.backend.renameNode(nodeId, newName);
  }

  async deleteNode(nodeId: string): Promise<void> {
    await this.backend.deleteNode(nodeId);
  }

  async moveNode(nodeId: string, newParentId: string | null): Promise<void> {
    await this.backend.moveNode(nodeId, newParentId);
  }

  async setTags(nodeId: string, tags: string[]): Promise<void> {
    await this.backend.setTags(nodeId, tags);
  }

  async addTag(nodeId: string, tag: string): Promise<void> {
    await this.backend.addTag(nodeId, tag);
  }

  async removeTag(nodeId: string, tag: string): Promise<void> {
    await this.backend.removeTag(nodeId, tag);
  }
}
