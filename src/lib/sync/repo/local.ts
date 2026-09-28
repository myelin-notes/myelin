import { Logger } from '@myelin/shared/logger';
import { invoke, isTauri } from '@tauri-apps/api/core';
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
import { ensureDirOnce, getAppDataDir } from '@/platform/tauri/fs-cache';
import { BaseRepository } from './base';
import { noteContentIndex } from './note-content-index';
import {
  computeRevision,
  createEmptyManifest,
  FILES_DIR,
  getStoredFileName,
  MANIFEST_PATH,
  migrate,
  type RepositorySnapshot,
  type VFSManifest,
} from './shared';
import type { FileType, RepositoryCapabilities, VFSNodeId } from './types';

const logger = new Logger('LocalRepository');
const MAX_IPC_WRITE_BYTES = 8 * 1024;

function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(binary);
}

// Deliberately just the byte count. This used to run canvas bytes through `summarizeNoteBytes`,
// which decodes the whole note into a throwaway Y.Doc — on both the read and the write of every
// save, on the thread that has to paint the next ink frame.
function summarizeStoredBytes(
  bytes: Uint8Array | null,
): Record<string, unknown> {
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
    batchedCommit: false,
  };

  private manifest: VFSManifest | null = null;

  constructor(private readonly storageRoot: string = '') {
    super();
  }

  async refresh(): Promise<void> {
    this.manifest = null;
    await this.loadManifestImpl();
  }

  async getRevealPath(nodeId: VFSNodeId): Promise<string | null> {
    return this.getStoredAbsolutePath(nodeId);
  }

  async getStoredAbsolutePath(nodeId: VFSNodeId): Promise<string | null> {
    const { manifest } = await this.loadManifestImpl();
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
        await this.writeBytesToDisk(filePath, bytes);
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

    const manifest = structuredClone(snapshot.manifest);
    await this.writeManifestToDisk(manifest);
    this.manifest = manifest;
    noteContentIndex.reconcile(this);
    logger.debug('Replaced local repository snapshot', {
      storageRoot: this.storageRoot,
      nodeCount: Object.keys(snapshot.manifest.nodes).length,
      noteCount: Object.keys(snapshot.notes).length,
    });
  }

  protected async loadManifestImpl(): Promise<{
    manifest: VFSManifest;
    revision: string | null;
  }> {
    if (this.manifest) {
      return { manifest: this.manifest, revision: null };
    }

    await this.ensureDirs();

    const manifestPath = this.resolveStoragePath(MANIFEST_PATH);

    if (await exists(manifestPath, { baseDir: BaseDirectory.AppData })) {
      const text = await readTextFile(manifestPath, {
        baseDir: BaseDirectory.AppData,
      });
      const manifest = JSON.parse(text) as VFSManifest;
      migrate(manifest);
      this.manifest = manifest;
      return { manifest: this.manifest, revision: null };
    }

    const manifest = createEmptyManifest();
    await this.writeManifestToDisk(manifest);
    this.manifest = manifest;
    return { manifest, revision: null };
  }

  protected async saveManifestImpl(
    manifest: VFSManifest,
    _revision: string | null,
    _action: string,
  ): Promise<string | null> {
    await this.writeManifestToDisk(manifest);
    this.manifest = manifest;
    return null;
  }

  protected async loadFileBytes(nodeId: VFSNodeId): Promise<{
    bytes: Uint8Array | null;
    revision: string | null;
  }> {
    const { manifest } = await this.loadManifestImpl();
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
      ...summarizeStoredBytes(bytes),
    });
    return { bytes, revision };
  }

  protected async saveFileBytes(
    nodeId: VFSNodeId,
    bytes: Uint8Array,
    _revision: string | null,
    _message: string,
  ): Promise<string | null> {
    const { manifest } = await this.loadManifestImpl();
    const node = manifest.nodes[nodeId];
    const nodeType = node?.type;
    if (node && node.type === 'file') {
      await this.ensureDirs();
      const filePath = this.resolveStoragePath(
        FILES_DIR,
        getStoredFileName(node),
      );
      await this.writeBytesToDisk(filePath, bytes);
      const revision = await computeRevision(bytes);
      logger.debug('Saved local note bytes to disk', {
        nodeId,
        storageRoot: this.storageRoot,
        filePath,
        revision,
        ...summarizeStoredBytes(bytes),
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
    const { manifest } = await this.loadManifestImpl();
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

  private async writeManifestToDisk(manifest: VFSManifest): Promise<void> {
    const filePath = this.resolveStoragePath(MANIFEST_PATH);
    const text = JSON.stringify(manifest, null, 2);
    if (isTauri() && text.length > MAX_IPC_WRITE_BYTES) {
      await this.writeBytesToDisk(filePath, new TextEncoder().encode(text));
    } else {
      await writeTextFile(filePath, text, { baseDir: BaseDirectory.AppData });
    }
  }

  private async writeBytesToDisk(
    filePath: string,
    bytes: Uint8Array,
  ): Promise<void> {
    if (bytes.byteLength <= MAX_IPC_WRITE_BYTES) {
      await writeFile(filePath, bytes, { baseDir: BaseDirectory.AppData });
    } else if (isTauri()) {
      const writeId = crypto.randomUUID();
      for (
        let offset = 0;
        offset < bytes.byteLength;
        offset += MAX_IPC_WRITE_BYTES
      ) {
        await invoke('write_local_file_chunk', {
          relativePath: filePath,
          writeId,
          offset,
          bytesBase64: encodeBase64(
            bytes.subarray(offset, offset + MAX_IPC_WRITE_BYTES),
          ),
          finalChunk: offset + MAX_IPC_WRITE_BYTES >= bytes.byteLength,
        });
        if (offset + MAX_IPC_WRITE_BYTES < bytes.byteLength) {
          await new Promise<void>((resolve) => {
            if (document.visibilityState === 'visible') {
              requestAnimationFrame(() => setTimeout(resolve, 0));
            } else {
              setTimeout(resolve, 0);
            }
          });
        }
      }
    } else {
      const file = await open(filePath, {
        write: true,
        create: true,
        truncate: true,
        baseDir: BaseDirectory.AppData,
      });
      try {
        for (let offset = 0; offset < bytes.byteLength; ) {
          const written = await file.write(
            bytes.subarray(offset, offset + MAX_IPC_WRITE_BYTES),
          );
          if (written === 0) {
            throw new Error('Could not write local file bytes');
          }
          offset += written;
        }
      } finally {
        await file.close();
      }
    }
  }

  /**
   * Paths here are relative to `BaseDirectory.AppData` and built from app constants, UUID filenames
   * and a sanitized storage root, so none of `join`'s extra behaviour (`..` normalization,
   * verbatim-prefix stripping) is reachable. Concatenating drops an IPC round trip from every file
   * operation, which adds up across the per-node loops in import and sync. `/` is fine everywhere:
   * Tauri's fs scope normalizes separators before matching, and Win32 accepts it in non-verbatim paths.
   */
  private resolveStoragePath(...segments: string[]): string {
    return [...(this.storageRoot ? [this.storageRoot] : []), ...segments]
      .filter(Boolean)
      .join('/');
  }
}
