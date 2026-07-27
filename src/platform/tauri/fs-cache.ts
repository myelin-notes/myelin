import { appDataDir } from '@tauri-apps/api/path';
import { BaseDirectory, mkdir } from '@tauri-apps/plugin-fs';

const pendingDirs = new Map<string, Promise<void>>();
let appDataDirPromise: Promise<string> | null = null;

/**
 * Creates an AppData directory, at most once per path per process.
 *
 * `mkdir` with `recursive` is idempotent, so the usual `exists` probe is
 * redundant. Caching the promise also collapses concurrent callers into a
 * single IPC round trip. Rejections are evicted so a later call can retry.
 */
export function ensureDirOnce(path: string): Promise<void> {
  let promise = pendingDirs.get(path);
  if (!promise) {
    promise = mkdir(path, {
      baseDir: BaseDirectory.AppData,
      recursive: true,
    }).catch((error: unknown) => {
      pendingDirs.delete(path);
      throw error;
    });
    pendingDirs.set(path, promise);
  }
  return promise;
}

/** `appDataDir()` is an IPC round trip returning a process-lifetime constant. */
export function getAppDataDir(): Promise<string> {
  if (!appDataDirPromise) {
    appDataDirPromise = appDataDir().catch((error: unknown) => {
      appDataDirPromise = null;
      throw error;
    });
  }
  return appDataDirPromise;
}

/** Test doubles swap the backing filesystem, which invalidates cached entries. */
export function resetFsCacheForTests(): void {
  pendingDirs.clear();
  appDataDirPromise = null;
}
