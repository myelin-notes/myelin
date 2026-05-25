import { join } from '@tauri-apps/api/path';
import {
  BaseDirectory,
  exists,
  mkdir,
  readFile,
  readTextFile,
  remove,
  writeFile,
  writeTextFile,
} from '@tauri-apps/plugin-fs';
import { Logger } from '@/lib/logger';

const VERSIONS_DIR = 'versions';
const INDEX_FILE = 'index.json';
const VERSION_EXT = '.myelin';
const MAX_VERSIONS = 50;
const VERSION_COOLDOWN_MS = 10 * 60 * 1000;

const logger = new Logger('VersionStore');

export interface VersionEntry {
  timestamp: number;
  byteLength: number;
}

export class VersionStore {
  private lastVersionByNote = new Map<string, number>();

  constructor(private readonly storageRoot: string) {}

  shouldCreateVersion(noteId: string): boolean {
    const last = this.lastVersionByNote.get(noteId) ?? 0;
    return Date.now() - last >= VERSION_COOLDOWN_MS;
  }

  async createSnapshot(noteId: string, bytes: Uint8Array): Promise<void> {
    const timestamp = Date.now();
    const dir = await this.resolveNoteVersionDir(noteId);
    await this.ensureDir(dir);

    const filePath = await join(dir, `${timestamp}${VERSION_EXT}`);
    await writeFile(filePath, bytes, { baseDir: BaseDirectory.AppData });

    const index = await this.readIndex(noteId);
    index.push({ timestamp, byteLength: bytes.byteLength });
    await this.writeIndex(noteId, index);

    this.lastVersionByNote.set(noteId, timestamp);
    logger.debug('Created version snapshot', {
      noteId,
      timestamp,
      byteLength: bytes.byteLength,
      totalVersions: index.length,
    });

    if (index.length > MAX_VERSIONS) {
      await this.pruneVersions(noteId, index);
    }
  }

  async listVersions(noteId: string): Promise<VersionEntry[]> {
    const index = await this.readIndex(noteId);
    return index.sort((a, b) => b.timestamp - a.timestamp);
  }

  async getVersionBytes(
    noteId: string,
    timestamp: number,
  ): Promise<Uint8Array> {
    const dir = await this.resolveNoteVersionDir(noteId);
    const filePath = await join(dir, `${timestamp}${VERSION_EXT}`);
    return readFile(filePath, { baseDir: BaseDirectory.AppData });
  }

  private async pruneVersions(
    noteId: string,
    index: VersionEntry[],
  ): Promise<void> {
    index.sort((a, b) => b.timestamp - a.timestamp);
    const toRemove = index.splice(MAX_VERSIONS);
    if (toRemove.length === 0) {
      return;
    }

    const dir = await this.resolveNoteVersionDir(noteId);
    await Promise.all(
      toRemove.map(async (entry) => {
        const filePath = await join(dir, `${entry.timestamp}${VERSION_EXT}`);
        try {
          await remove(filePath, { baseDir: BaseDirectory.AppData });
        } catch {
          // File may already be removed
        }
      }),
    );

    await this.writeIndex(noteId, index);
    logger.debug('Pruned old versions', {
      noteId,
      removed: toRemove.length,
      remaining: index.length,
    });
  }

  private async readIndex(noteId: string): Promise<VersionEntry[]> {
    const dir = await this.resolveNoteVersionDir(noteId);
    const indexPath = await join(dir, INDEX_FILE);
    if (!(await exists(indexPath, { baseDir: BaseDirectory.AppData }))) {
      return [];
    }
    try {
      const text = await readTextFile(indexPath, {
        baseDir: BaseDirectory.AppData,
      });
      return JSON.parse(text) as VersionEntry[];
    } catch {
      return [];
    }
  }

  private async writeIndex(
    noteId: string,
    index: VersionEntry[],
  ): Promise<void> {
    const dir = await this.resolveNoteVersionDir(noteId);
    await this.ensureDir(dir);
    const indexPath = await join(dir, INDEX_FILE);
    await writeTextFile(indexPath, JSON.stringify(index), {
      baseDir: BaseDirectory.AppData,
    });
  }

  private async resolveNoteVersionDir(noteId: string): Promise<string> {
    const segments = [this.storageRoot, VERSIONS_DIR, noteId].filter(Boolean);
    return segments.length === 1 ? segments[0] : join(...segments);
  }

  private async ensureDir(dirPath: string): Promise<void> {
    if (!(await exists(dirPath, { baseDir: BaseDirectory.AppData }))) {
      await mkdir(dirPath, {
        baseDir: BaseDirectory.AppData,
        recursive: true,
      });
    }
  }
}
