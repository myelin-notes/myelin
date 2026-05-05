import { convertFileSrc } from '@tauri-apps/api/core';
import { appCacheDir, join } from '@tauri-apps/api/path';
import {
  BaseDirectory,
  exists,
  mkdir,
  open,
  remove as removeFile,
  stat,
} from '@tauri-apps/plugin-fs';
import type { FileId } from '@/lib/sync';

const THUMBNAILS_DIR = 'Thumbnails';

async function ensureDir(): Promise<void> {
  if (!(await exists(THUMBNAILS_DIR, { baseDir: BaseDirectory.AppCache }))) {
    await mkdir(THUMBNAILS_DIR, {
      baseDir: BaseDirectory.AppCache,
      recursive: true,
    });
  }
}

function relPath(nodeId: FileId): string {
  return `${THUMBNAILS_DIR}/${nodeId}.png`;
}

export async function readUrl(nodeId: FileId): Promise<string | null> {
  const rel = relPath(nodeId);
  if (!(await exists(rel, { baseDir: BaseDirectory.AppCache }))) {
    return null;
  }
  const absolute = await join(await appCacheDir(), rel);
  return convertFileSrc(absolute);
}

export async function writeBlob(nodeId: FileId, blob: Blob): Promise<void> {
  await ensureDir();
  const file = await open(relPath(nodeId), {
    write: true,
    append: false,
    create: true,
    truncate: true,
    baseDir: BaseDirectory.AppCache,
  });
  try {
    await file.write(new Uint8Array(await blob.arrayBuffer()));
  } finally {
    await file.close();
  }
}

export async function removeEntry(nodeId: FileId): Promise<void> {
  const rel = relPath(nodeId);
  if (await exists(rel, { baseDir: BaseDirectory.AppCache })) {
    await removeFile(rel, { baseDir: BaseDirectory.AppCache });
  }
}

export async function getMtime(nodeId: FileId): Promise<number | null> {
  const rel = relPath(nodeId);
  if (!(await exists(rel, { baseDir: BaseDirectory.AppCache }))) {
    return null;
  }
  const info = await stat(rel, { baseDir: BaseDirectory.AppCache });
  const mtime = info.mtime;
  return mtime ? mtime.getTime() : null;
}
