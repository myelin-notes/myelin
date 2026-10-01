import * as scoped from 'tauri-plugin-scoped-storage-api';
import { BaseRepository } from '@/lib/sync/repo/base';
import {
  computeRevision,
  createEmptyManifest,
  getStoredFileName,
  migrate,
  type VFSManifest,
} from '@/lib/sync/repo/shared';
import type {
  FileImportSource,
  FileType,
  RenameReferencesResult,
  RepositoryCapabilities,
  VFSNodeId,
} from '@/lib/sync/repo/types';
import { getRepositoryTestStorage } from './repository-test-utils';

/** Storage boundary for tests of shared repository behavior; native sync has its own tests. */
export class TestRepository extends BaseRepository {
  readonly kind = 'local-storage';
  readonly capabilities: RepositoryCapabilities = {
    polling: false,
    liveSync: false,
    batchedCommit: false,
  };
  private manifest: VFSManifest | null = null;

  constructor(private readonly storageRoot = '') {
    super();
  }

  override async importFile(
    name: string,
    fileType: FileType,
    parentId: VFSNodeId | null,
    source: FileImportSource,
  ): Promise<VFSNodeId> {
    const bytes =
      source.kind === 'scoped'
        ? await scoped.readFile(source.folderId, source.path)
        : await getRepositoryTestStorage().readFile(source.path);
    return this.createFile(name, fileType, parentId, bytes);
  }

  private path(name: string): string {
    return this.storageRoot ? `${this.storageRoot}/${name}` : name;
  }

  protected async loadManifestImpl(): Promise<{
    manifest: VFSManifest;
    revision: null;
  }> {
    if (!this.manifest) {
      const storage = getRepositoryTestStorage();
      const path = this.path('manifest.json');
      this.manifest = (await storage.exists(path))
        ? (JSON.parse(await storage.readTextFile(path)) as VFSManifest)
        : createEmptyManifest();
      migrate(this.manifest);
      await storage.writeTextFile(path, JSON.stringify(this.manifest));
    }
    return { manifest: this.manifest, revision: null };
  }

  protected async saveManifestImpl(manifest: VFSManifest): Promise<null> {
    await getRepositoryTestStorage().writeTextFile(
      this.path('manifest.json'),
      JSON.stringify(manifest),
    );
    this.manifest = manifest;
    return null;
  }

  protected async loadFileBytes(nodeId: VFSNodeId): Promise<{
    bytes: Uint8Array | null;
    revision: string | null;
  }> {
    const { manifest } = await this.loadManifestImpl();
    const node = manifest.nodes[nodeId];
    if (node?.type !== 'file') {
      return { bytes: null, revision: null };
    }
    const storage = getRepositoryTestStorage();
    const path = this.path(`files/${getStoredFileName(node)}`);
    const bytes = (await storage.exists(path))
      ? await storage.readFile(path)
      : null;
    return {
      bytes: bytes?.length ? bytes : null,
      revision: await computeRevision(bytes),
    };
  }

  protected async saveFileBytes(
    nodeId: VFSNodeId,
    bytes: Uint8Array,
  ): Promise<string | null> {
    const { manifest } = await this.loadManifestImpl();
    const node = manifest.nodes[nodeId];
    if (node?.type === 'file') {
      await getRepositoryTestStorage().writeFile(
        this.path(`files/${getStoredFileName(node)}`),
        bytes,
      );
    }
    return computeRevision(bytes);
  }

  protected async deleteFileBytes(
    nodeId: VFSNodeId,
    fileType?: FileType,
  ): Promise<void> {
    const { manifest } = await this.loadManifestImpl();
    const node = manifest.nodes[nodeId];
    if (node?.type !== 'file' && !fileType) {
      return;
    }
    const path = this.path(
      `files/${getStoredFileName(node?.type === 'file' ? node : { id: nodeId, fileType: fileType! })}`,
    );
    const storage = getRepositoryTestStorage();
    if (await storage.exists(path)) {
      await storage.remove(path);
    }
  }

  override async renameReferences(): Promise<RenameReferencesResult> {
    throw new Error('Reference rewrites require the native repository.');
  }

  override async restoreFileVersion(): Promise<void> {
    throw new Error('Version restores require the native repository.');
  }

  override async getStoredAbsolutePath(
    nodeId: VFSNodeId,
  ): Promise<string | null> {
    const { manifest } = await this.loadManifestImpl();
    const node = manifest.nodes[nodeId];
    const storage = getRepositoryTestStorage();
    return node?.type === 'file'
      ? storage.join(
          await storage.appDataDir(),
          this.path(`files/${getStoredFileName(node)}`),
        )
      : null;
  }

  override getRevealPath(nodeId: VFSNodeId): Promise<string | null> {
    return this.getStoredAbsolutePath(nodeId);
  }
}
