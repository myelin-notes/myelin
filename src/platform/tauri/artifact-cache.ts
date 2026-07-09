import type { ArtifactCache } from '@myelin/editor/platform/types';
import { convertFileSrc } from '@tauri-apps/api/core';
import { appCacheDir, join } from '@tauri-apps/api/path';
import {
  BaseDirectory,
  exists,
  mkdir,
  open,
  remove as removeFile,
} from '@tauri-apps/plugin-fs';

async function ensureParentDir(path: string): Promise<void> {
  const parent = path.split('/').slice(0, -1).join('/');
  if (!parent) {
    return;
  }
  if (!(await exists(parent, { baseDir: BaseDirectory.AppCache }))) {
    await mkdir(parent, {
      baseDir: BaseDirectory.AppCache,
      recursive: true,
    });
  }
}

/** Artifact storage under the app cache directory, keyed by relative path. */
export const artifactCache: ArtifactCache = {
  async getUrl(path) {
    if (!(await exists(path, { baseDir: BaseDirectory.AppCache }))) {
      return null;
    }
    const absolute = await join(await appCacheDir(), path);
    return convertFileSrc(absolute);
  },

  async write(path, data) {
    await ensureParentDir(path);
    const file = await open(path, {
      write: true,
      append: false,
      create: true,
      truncate: true,
      baseDir: BaseDirectory.AppCache,
    });
    try {
      await file.write(new Uint8Array(await data.arrayBuffer()));
    } finally {
      await file.close();
    }
  },

  async remove(path) {
    if (await exists(path, { baseDir: BaseDirectory.AppCache })) {
      await removeFile(path, {
        baseDir: BaseDirectory.AppCache,
        recursive: true,
      });
    }
  },
};
