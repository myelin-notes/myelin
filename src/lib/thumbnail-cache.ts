import { convertFileSrc } from '@tauri-apps/api/core';
import { appCacheDir, join } from '@tauri-apps/api/path';
import {
  BaseDirectory,
  exists as fsExists,
  mkdir,
  open,
  remove as removeFile,
} from '@tauri-apps/plugin-fs';

const THUMBNAILS_DIR = 'Thumbnails';
async function ensureThumbnailDir(): Promise<void> {
  if (!(await fsExists(THUMBNAILS_DIR, { baseDir: BaseDirectory.AppCache }))) {
    await mkdir(THUMBNAILS_DIR, {
      baseDir: BaseDirectory.AppCache,
      recursive: true,
    });
  }
}

export namespace ThumbnailCache {
  export async function getUrl(nodeId: string): Promise<string> {
    const url = await join(
      await appCacheDir(),
      THUMBNAILS_DIR,
      `${nodeId}.png`,
    );
    return convertFileSrc(url);
  }

  export async function save(nodeId: string, blob: Blob): Promise<void> {
    await ensureThumbnailDir();

    const thumbPath = await join(THUMBNAILS_DIR, `${nodeId}.png`);
    const file = await open(thumbPath, {
      write: true,
      append: false,
      create: true,
      baseDir: BaseDirectory.AppCache,
    });
    await file.write(new Uint8Array(await blob.arrayBuffer()));
    await file.close();
  }

  export async function remove(nodeId: string): Promise<void> {
    const thumbPath = await join(THUMBNAILS_DIR, `${nodeId}.png`);
    if (await fsExists(thumbPath, { baseDir: BaseDirectory.AppCache })) {
      await removeFile(thumbPath, { baseDir: BaseDirectory.AppCache });
    }
  }

  export async function exists(nodeId: string): Promise<boolean> {
    const thumbPath = await join(THUMBNAILS_DIR, `${nodeId}.png`);
    return await fsExists(thumbPath, { baseDir: BaseDirectory.AppCache });
  }
}
