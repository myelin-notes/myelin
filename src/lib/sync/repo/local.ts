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
  migrateManifest,
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
    return join(await appDataDir(), FILES_DIR, getNoteFileName(nodeId));
  }

  protected async onFileCreated(nodeId: string): Promise<void> {
    await this.ensureDirs();
    const filePath = await join(FILES_DIR, getNoteFileName(nodeId));
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

    if (await exists(MANIFEST_PATH, { baseDir: BaseDirectory.AppData })) {
      const text = await readTextFile(MANIFEST_PATH, {
        baseDir: BaseDirectory.AppData,
      });
      const parsed = JSON.parse(text) as VFSManifest;
      this.manifest = migrateManifest(parsed);
      await this.writeManifestToDisk(this.manifest);
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

    const filePath = await join(FILES_DIR, getNoteFileName(nodeId));
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
      const filePath = await join(FILES_DIR, getNoteFileName(nodeId));
      await writeFile(filePath, bytes, { baseDir: BaseDirectory.AppData });
    }

    return computeRevision(bytes);
  }

  protected async deleteNoteBytes(nodeId: string): Promise<void> {
    const filePath = await join(FILES_DIR, getNoteFileName(nodeId));
    if (await exists(filePath, { baseDir: BaseDirectory.AppData })) {
      await remove(filePath, { baseDir: BaseDirectory.AppData });
    }
  }

  private async ensureDirs(): Promise<void> {
    if (!(await exists('', { baseDir: BaseDirectory.AppData }))) {
      await mkdir('', { baseDir: BaseDirectory.AppData });
    }
    if (!(await exists(FILES_DIR, { baseDir: BaseDirectory.AppData }))) {
      await mkdir(FILES_DIR, { baseDir: BaseDirectory.AppData });
    }
  }

  private async writeManifestToDisk(manifest: VFSManifest): Promise<void> {
    await writeTextFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2), {
      baseDir: BaseDirectory.AppData,
    });
  }
}
