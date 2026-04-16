import * as Y from 'yjs';
import { invoke } from '@tauri-apps/api/core';
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
  createDocFromBytes,
  createEmptyManifest,
  createFileNode,
  createFolderNode,
  createNodeId,
  deleteNodeFromManifest,
  getFolderChain,
  getNodesByAnyTag,
  getNotePath,
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

interface GitHubContentPayload {
  sha: string | null;
  bytes: number[] | null;
}

interface GitHubWritePayload {
  sha: string;
}

interface GitHubRepositoryConfig {
  owner: string;
  repo: string;
  branch: string;
  credentialId: string;
}

const MAX_MANIFEST_RETRIES = 4;

function isGitHubConflictError(error: unknown): boolean {
  const message = String(error);
  return (
    message.includes('(409)') ||
    message.includes(' 409 ') ||
    message.includes('(422)')
  );
}

export class GitHubRepository
  implements Repository, YjsSyncTarget, RepositoryLifecycle
{
  public readonly kind = 'github';
  public readonly capabilities: RepositoryCapabilities = {
    polling: true,
    liveSync: false,
  };

  constructor(private readonly config: GitHubRepositoryConfig) {}

  async initialize(): Promise<void> {
    await this.loadManifest();
  }

  async refresh(): Promise<void> {}

  async flushPending(): Promise<void> {}

  async dispose(): Promise<void> {}

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

  async getFolderChain(folderId: string | null): Promise<VFSFolderNode[]> {
    const { manifest } = await this.loadManifest();
    return getFolderChain(manifest, folderId);
  }

  async searchNodes(query: string): Promise<VFSNode[]> {
    const { manifest } = await this.loadManifest();
    return searchNodes(manifest, query);
  }

  async getNodesByAnyTag(tags: string[]): Promise<VFSNode[]> {
    const { manifest } = await this.loadManifest();
    return getNodesByAnyTag(manifest, tags);
  }

  async listTags(): Promise<RepositoryTag[]> {
    const { manifest } = await this.loadManifest();
    return listTags(manifest);
  }

  async getStats(): Promise<RepositoryStats> {
    const { manifest } = await this.loadManifest();
    return getStats(manifest);
  }

  async getRecentFiles(limit: number = 3): Promise<VFSFileNode[]> {
    const { manifest } = await this.loadManifest();
    return getRecentFiles(manifest, limit);
  }

  async getUniqueFileName(
    baseName: string,
    parentId: string | null,
  ): Promise<string> {
    const { manifest } = await this.loadManifest();
    return getUniqueFileName(manifest, baseName, parentId);
  }

  async createFolder(name: string, parentId: string | null): Promise<string> {
    return this.withManifestMutation('Create folder', (manifest) => {
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
    return this.withManifestMutation('Create file', (manifest) => {
      const id = createNodeId();
      const now = Date.now();

      manifest.nodes[id] = createFileNode(id, name, fileType, parentId, now);

      addChild(manifest, parentId, id);
      return id;
    });
  }

  async renameNode(nodeId: string, newName: string): Promise<void> {
    await this.withManifestMutation('Rename node', (manifest) => {
      const node = manifest.nodes[nodeId];
      if (!node) {
        return;
      }

      node.name = newName;
      node.modifiedAt = Date.now();
    });
  }

  async deleteNode(nodeId: string): Promise<void> {
    const deletedFileIds = await this.withManifestMutation(
      'Delete node',
      (manifest) => deleteNodeFromManifest(manifest, nodeId),
    );

    await Promise.all(
      deletedFileIds.map(async (fileId) => {
        await this.deleteNoteData(fileId);
        await ThumbnailCache.remove(fileId);
      }),
    );
  }

  async moveNode(nodeId: string, newParentId: string | null): Promise<void> {
    await this.withManifestMutation('Move node', (manifest) => {
      moveNodeInManifest(manifest, nodeId, newParentId);
    });
  }

  async setTags(nodeId: string, tags: string[]): Promise<void> {
    await this.withManifestMutation('Set node tags', (manifest) => {
      const node = manifest.nodes[nodeId];
      if (!node) {
        return;
      }

      node.tags = tags;
      node.modifiedAt = Date.now();
    });
  }

  async addTag(nodeId: string, tag: string): Promise<void> {
    await this.withManifestMutation('Add node tag', (manifest) => {
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
    await this.withManifestMutation('Remove node tag', (manifest) => {
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
    const revision = await this.saveNoteData(
      nodeId,
      mergedBytes,
      remote.revision,
      `Update note ${nodeId}`,
    );

    return {
      accepted: true,
      remoteUpdate: null,
      stateVector: Y.encodeStateVector(remote.doc),
      revision,
      update: mergedBytes,
    };
  }

  private async withManifestMutation<T>(
    action: string,
    mutator: (manifest: VFSManifest) => T,
  ): Promise<T> {
    for (let attempt = 0; attempt < MAX_MANIFEST_RETRIES; attempt++) {
      const { manifest, revision } = await this.loadManifest();
      const nextManifest = structuredClone(manifest);
      const result = mutator(nextManifest);

      try {
        await this.saveManifest(nextManifest, revision, action);
        return result;
      } catch (error) {
        if (
          attempt < MAX_MANIFEST_RETRIES - 1 &&
          isGitHubConflictError(error)
        ) {
          continue;
        }
        throw error;
      }
    }

    throw new Error(
      `Failed to ${action.toLowerCase()} after retrying GitHub conflicts.`,
    );
  }

  private async loadManifest(): Promise<{
    manifest: VFSManifest;
    revision: string | null;
  }> {
    const payload = await this.getContents(MANIFEST_PATH);
    if (!payload.bytes || payload.bytes.byteLength === 0) {
      return {
        manifest: createEmptyManifest(),
        revision: payload.sha,
      };
    }

    const text = new TextDecoder().decode(payload.bytes);
    const parsed = JSON.parse(text) as VFSManifest;
    return {
      manifest: migrateManifest(parsed),
      revision: payload.sha,
    };
  }

  private async saveManifest(
    manifest: VFSManifest,
    revision: string | null,
    action: string,
  ): Promise<string> {
    const bytes = new TextEncoder().encode(JSON.stringify(manifest, null, 2));
    return this.putContents(
      MANIFEST_PATH,
      bytes,
      revision,
      `${action} manifest`,
    );
  }

  private async getContents(path: string): Promise<{
    sha: string | null;
    bytes: Uint8Array | null;
  }> {
    const payload = await invoke<GitHubContentPayload>('github_get_contents', {
      owner: this.config.owner,
      repo: this.config.repo,
      branch: this.config.branch,
      credentialId: this.config.credentialId,
      path,
    });

    return {
      sha: payload.sha,
      bytes: payload.bytes ? new Uint8Array(payload.bytes) : null,
    };
  }

  private async putContents(
    path: string,
    bytes: Uint8Array,
    sha: string | null,
    message: string,
  ): Promise<string> {
    const payload = await invoke<GitHubWritePayload>('github_put_contents', {
      owner: this.config.owner,
      repo: this.config.repo,
      branch: this.config.branch,
      credentialId: this.config.credentialId,
      path,
      bytes: Array.from(bytes),
      sha,
      message,
    });
    return payload.sha;
  }

  private async deleteContents(
    path: string,
    sha: string,
    message: string,
  ): Promise<void> {
    await invoke('github_delete_contents', {
      owner: this.config.owner,
      repo: this.config.repo,
      branch: this.config.branch,
      credentialId: this.config.credentialId,
      path,
      sha,
      message,
    });
  }

  private async loadNoteData(nodeId: string): Promise<{
    bytes: Uint8Array | null;
    revision: string | null;
  }> {
    const payload = await this.getContents(this.notePath(nodeId));
    return {
      bytes: payload.bytes,
      revision: payload.sha,
    };
  }

  private async saveNoteData(
    nodeId: string,
    bytes: Uint8Array,
    revision: string | null,
    message: string,
  ): Promise<string> {
    return this.putContents(this.notePath(nodeId), bytes, revision, message);
  }

  private async deleteNoteData(nodeId: string): Promise<void> {
    const payload = await this.getContents(this.notePath(nodeId));
    if (!payload.sha) {
      return;
    }

    await this.deleteContents(
      this.notePath(nodeId),
      payload.sha,
      `Delete note ${nodeId}`,
    );
  }

  private notePath(nodeId: string): string {
    return getNotePath(nodeId);
  }

  private async readYjsSyncState(nodeId: string): Promise<{
    bytes: Uint8Array | null;
    doc: Y.Doc;
    stateVector: Uint8Array;
    revision: string | null;
  }> {
    const { bytes, revision } = await this.loadNoteData(nodeId);
    const doc = createDocFromBytes(bytes);
    return {
      bytes,
      doc,
      stateVector: Y.encodeStateVector(doc),
      revision,
    };
  }
}
