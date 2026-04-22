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
import { BaseRepository } from './base';
import {
  computeRevision,
  createEmptyManifest,
  FILES_DIR,
  getNoteFileName,
  MANIFEST_PATH,
  type RepositorySnapshot,
  type VFSManifest,
} from './shared';
import type { RepositoryCapabilities } from './types';

export class LocalRepository extends BaseRepository {
  public readonly kind = 'local-storage';
  public readonly capabilities: RepositoryCapabilities = {
    polling: false,
    liveSync: false,
  };

  private manifest: VFSManifest | null = null;

  constructor(private readonly storageRoot: string = '') {
    super();
  }

  async refresh(): Promise<void> {
    this.manifest = null;
    await this.loadManifestImpl();
  }

  async getRevealPath(nodeId: string): Promise<string | null> {
    const { manifest } = await this.loadManifestImpl();
    const node = manifest.nodes[nodeId];
    if (!node || node.type !== 'file') {
      return null;
    }
    return join(
      await appDataDir(),
      ...(this.storageRoot ? [this.storageRoot] : []),
      FILES_DIR,
      getNoteFileName(nodeId),
    );
  }

  async replaceSnapshot(snapshot: RepositorySnapshot): Promise<void> {
    await this.ensureDirs();

    const filesDirPath = await this.resolveStoragePath(FILES_DIR);
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

      const filePath = await this.resolveStoragePath(
        FILES_DIR,
        getNoteFileName(node.id),
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

    const manifest = structuredClone(snapshot.manifest);
    await this.writeManifestToDisk(manifest);
    this.manifest = manifest;
  }

  protected async onFileCreated(nodeId: string): Promise<void> {
    await this.ensureDirs();
    const filePath = await this.resolveStoragePath(
      FILES_DIR,
      getNoteFileName(nodeId),
    );
    const file = await open(filePath, {
      write: true,
      create: true,
      baseDir: BaseDirectory.AppData,
    });
    await file.close();
  }

  protected async onNoteSaved(nodeId: string): Promise<void> {
    await this.mutateManifest('Touch note', (manifest) => {
      const node = manifest.nodes[nodeId];
      if (node && node.type === 'file') {
        node.modifiedAt = Date.now();
      }
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

    const manifestPath = await this.resolveStoragePath(MANIFEST_PATH);

    if (await exists(manifestPath, { baseDir: BaseDirectory.AppData })) {
      const text = await readTextFile(manifestPath, {
        baseDir: BaseDirectory.AppData,
      });
      this.manifest = JSON.parse(text) as VFSManifest;
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

  protected async loadNoteBytes(nodeId: string): Promise<{
    bytes: Uint8Array | null;
    revision: string | null;
  }> {
    const { manifest } = await this.loadManifestImpl();
    const node = manifest.nodes[nodeId];
    if (!node || node.type !== 'file') {
      return { bytes: null, revision: null };
    }

    const filePath = await this.resolveStoragePath(
      FILES_DIR,
      getNoteFileName(nodeId),
    );
    if (!(await exists(filePath, { baseDir: BaseDirectory.AppData }))) {
      return { bytes: null, revision: null };
    }

    const data = await readFile(filePath, { baseDir: BaseDirectory.AppData });
    const bytes = data.length > 0 ? data : null;
    return { bytes, revision: await computeRevision(bytes) };
  }

  protected async saveNoteBytes(
    nodeId: string,
    bytes: Uint8Array,
    _revision: string | null,
    _message: string,
  ): Promise<string | null> {
    const { manifest } = await this.loadManifestImpl();
    const node = manifest.nodes[nodeId];
    if (node && node.type === 'file' && bytes.byteLength > 0) {
      await this.ensureDirs();
      const filePath = await this.resolveStoragePath(
        FILES_DIR,
        getNoteFileName(nodeId),
      );
      await writeFile(filePath, bytes, { baseDir: BaseDirectory.AppData });
    }

    return computeRevision(bytes);
  }

  protected async deleteNoteBytes(nodeId: string): Promise<void> {
    const filePath = await this.resolveStoragePath(
      FILES_DIR,
      getNoteFileName(nodeId),
    );
    if (await exists(filePath, { baseDir: BaseDirectory.AppData })) {
      await remove(filePath, { baseDir: BaseDirectory.AppData });
    }
  }

  private async ensureDirs(): Promise<void> {
    const rootPath = await this.resolveStoragePath();
    if (
      rootPath &&
      !(await exists(rootPath, { baseDir: BaseDirectory.AppData }))
    ) {
      await mkdir(rootPath, {
        baseDir: BaseDirectory.AppData,
        recursive: true,
      });
    }

    const filesDirPath = await this.resolveStoragePath(FILES_DIR);
    if (!(await exists(filesDirPath, { baseDir: BaseDirectory.AppData }))) {
      await mkdir(filesDirPath, {
        baseDir: BaseDirectory.AppData,
        recursive: true,
      });
    }
  }

  private async writeManifestToDisk(manifest: VFSManifest): Promise<void> {
    await writeTextFile(
      await this.resolveStoragePath(MANIFEST_PATH),
      JSON.stringify(manifest, null, 2),
      {
        baseDir: BaseDirectory.AppData,
      },
    );
  }

  private async resolveStoragePath(...segments: string[]): Promise<string> {
    const filteredSegments = [
      ...(this.storageRoot ? [this.storageRoot] : []),
      ...segments,
    ].filter(Boolean);

    if (filteredSegments.length === 0) {
      return '';
    }

    if (filteredSegments.length === 1) {
      return filteredSegments[0];
    }

    return join(...filteredSegments);
  }
}
