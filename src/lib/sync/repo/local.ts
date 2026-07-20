import { summarizeNoteBytes } from '@myelin/editor/note/state-summary';
import { join } from '@tauri-apps/api/path';
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
import { Logger } from '@/lib/logger';
import { ensureDirOnce, getAppDataDir } from '@/platform/tauri/fs-cache';
import { BaseRepository } from './base';
import { createManifestDocument, encodeManifestDocument } from './manifest-yjs';
import {
  computeRevision,
  FILES_DIR,
  getStoredFileName,
  MANIFEST_PATH,
  type RepositorySnapshot,
} from './shared';
import type { FileType, RepositoryCapabilities, VFSNodeId } from './types';

const logger = new Logger('LocalRepository');

function summarizeStoredBytes(
  fileType: FileType,
  bytes: Uint8Array | null,
): Record<string, unknown> {
  if (fileType === 'mcanvas') {
    return summarizeNoteBytes(bytes);
  }
  return {
    byteLength: bytes?.byteLength ?? 0,
    hasBytes: Boolean(bytes && bytes.byteLength > 0),
  };
}

export class LocalRepository extends BaseRepository {
  public readonly kind = 'local-storage';
  public readonly capabilities: RepositoryCapabilities = {
    polling: false,
    liveSync: false,
  };

  private manifestUpdate: Uint8Array | null = null;

  constructor(private readonly storageRoot: string = '') {
    super();
  }

  async refresh(): Promise<void> {
    this.manifestUpdate = null;
    this.resetManifest();
    await this.initialize();
  }

  async getRevealPath(nodeId: VFSNodeId): Promise<string | null> {
    return this.getStoredAbsolutePath(nodeId);
  }

  async getStoredAbsolutePath(nodeId: VFSNodeId): Promise<string | null> {
    const { manifest } = await this.loadManifest();
    const node = manifest.nodes[nodeId];
    if (!node || node.type !== 'file') {
      return null;
    }
    return join(
      await getAppDataDir(),
      ...(this.storageRoot ? [this.storageRoot] : []),
      FILES_DIR,
      getStoredFileName(node),
    );
  }

  async replaceSnapshot(snapshot: RepositorySnapshot): Promise<void> {
    await this.ensureDirs();

    const filesDirPath = this.resolveStoragePath(FILES_DIR);
    if (await exists(filesDirPath, { baseDir: BaseDirectory.AppData })) {
      await remove(filesDirPath, {
        baseDir: BaseDirectory.AppData,
        recursive: true,
      });
    }
    await mkdir(filesDirPath, { baseDir: BaseDirectory.AppData });

    for (const node of Object.values(snapshot.manifest.nodes)) {
      if (node.type !== 'file') {
        continue;
      }

      const filePath = this.resolveStoragePath(
        FILES_DIR,
        getStoredFileName(node),
      );
      const bytes = snapshot.notes[node.id] ?? null;
      if (bytes && bytes.byteLength > 0) {
        await writeFile(filePath, bytes, { baseDir: BaseDirectory.AppData });
        continue;
      }

      const file = await open(filePath, {
        write: true,
        create: true,
        truncate: true,
        baseDir: BaseDirectory.AppData,
      });
      await file.close();
    }

    this.manifestUpdate = encodeManifestDocument(
      createManifestDocument(snapshot.manifest),
    );
    await this.writeManifestToDisk(this.manifestUpdate);
    this.resetManifest();
    logger.debug('Replaced local repository snapshot', {
      storageRoot: this.storageRoot,
      nodeCount: Object.keys(snapshot.manifest.nodes).length,
      noteCount: Object.keys(snapshot.notes).length,
    });
  }

  protected async loadManifestImpl(): Promise<{
    update: Uint8Array | null;
    revision: string | null;
  }> {
    if (this.manifestUpdate) {
      return { update: new Uint8Array(this.manifestUpdate), revision: null };
    }

    await this.ensureDirs();

    const manifestPath = this.resolveStoragePath(MANIFEST_PATH);

    if (await exists(manifestPath, { baseDir: BaseDirectory.AppData })) {
      const text = await readTextFile(manifestPath, {
        baseDir: BaseDirectory.AppData,
      });
      this.manifestUpdate = new TextEncoder().encode(text);
      return { update: new Uint8Array(this.manifestUpdate), revision: null };
    }

    this.manifestUpdate = encodeManifestDocument(createManifestDocument());
    await this.writeManifestToDisk(this.manifestUpdate);
    return { update: new Uint8Array(this.manifestUpdate), revision: null };
  }

  protected async saveManifestImpl(
    update: Uint8Array,
    _revision: string | null,
    _action: string,
  ): Promise<string | null> {
    await this.writeManifestToDisk(update);
    this.manifestUpdate = new Uint8Array(update);
    return null;
  }

  protected async loadFileBytes(nodeId: VFSNodeId): Promise<{
    bytes: Uint8Array | null;
    revision: string | null;
  }> {
    const { manifest } = await this.loadManifest();
    const node = manifest.nodes[nodeId];
    if (!node || node.type !== 'file') {
      return { bytes: null, revision: null };
    }

    const filePath = this.resolveStoragePath(
      FILES_DIR,
      getStoredFileName(node),
    );
    if (!(await exists(filePath, { baseDir: BaseDirectory.AppData }))) {
      logger.debug('Local note bytes missing on disk', {
        nodeId,
        storageRoot: this.storageRoot,
        filePath,
      });
      return { bytes: null, revision: null };
    }

    const data = await readFile(filePath, { baseDir: BaseDirectory.AppData });
    const bytes = data.length > 0 ? data : null;
    const revision = await computeRevision(bytes);
    logger.debug('Loaded local note bytes from disk', {
      nodeId,
      storageRoot: this.storageRoot,
      filePath,
      revision,
      ...summarizeStoredBytes(node.fileType, bytes),
    });
    return { bytes, revision };
  }

  protected async saveFileBytes(
    nodeId: VFSNodeId,
    bytes: Uint8Array,
    _revision: string | null,
    _message: string,
  ): Promise<string | null> {
    const { manifest } = await this.loadManifest();
    const node = manifest.nodes[nodeId];
    const nodeType = node?.type;
    if (node && node.type === 'file') {
      await this.ensureDirs();
      const filePath = this.resolveStoragePath(
        FILES_DIR,
        getStoredFileName(node),
      );
      await writeFile(filePath, bytes, { baseDir: BaseDirectory.AppData });
      const revision = await computeRevision(bytes);
      logger.debug('Saved local note bytes to disk', {
        nodeId,
        storageRoot: this.storageRoot,
        filePath,
        revision,
        ...summarizeStoredBytes(node.fileType, bytes),
      });
      return revision;
    }

    const revision = await computeRevision(bytes);
    logger.debug('Skipped local note byte write', {
      nodeId,
      storageRoot: this.storageRoot,
      revision,
      byteLength: bytes.byteLength,
      nodeExists: Boolean(node),
      isFile: nodeType === 'file',
    });
    return revision;
  }

  protected async deleteFileBytes(
    nodeId: VFSNodeId,
    fileType?: FileType,
  ): Promise<void> {
    const { manifest } = await this.loadManifest();
    const node = manifest.nodes[nodeId];
    if ((!node || node.type !== 'file') && !fileType) {
      return;
    }

    const filePath = this.resolveStoragePath(
      FILES_DIR,
      getStoredFileName(
        node?.type === 'file' ? node : { id: nodeId, fileType: fileType! },
      ),
    );
    if (await exists(filePath, { baseDir: BaseDirectory.AppData })) {
      await remove(filePath, { baseDir: BaseDirectory.AppData });
      logger.debug('Deleted local note bytes from disk', {
        nodeId,
        storageRoot: this.storageRoot,
        filePath,
      });
    }
  }

  private async ensureDirs(): Promise<void> {
    const rootPath = this.resolveStoragePath();
    if (rootPath) {
      await ensureDirOnce(rootPath);
    }

    await ensureDirOnce(this.resolveStoragePath(FILES_DIR));
  }

  private async writeManifestToDisk(update: Uint8Array): Promise<void> {
    await writeTextFile(
      this.resolveStoragePath(MANIFEST_PATH),
      new TextDecoder().decode(update),
      {
        baseDir: BaseDirectory.AppData,
      },
    );
  }

  /**
   * Paths here are relative to `BaseDirectory.AppData` and built from app
   * constants plus UUID filenames, so none of `join`'s extra behaviour (`..`
   * normalization, verbatim-prefix stripping) is reachable. Concatenating
   * avoids an IPC round trip per file operation, which dominates workspace
   * load. `/` is accepted by the fs plugin on every platform.
   */
  private resolveStoragePath(...segments: string[]): string {
    return [...(this.storageRoot ? [this.storageRoot] : []), ...segments]
      .filter(Boolean)
      .join('/');
  }
}
