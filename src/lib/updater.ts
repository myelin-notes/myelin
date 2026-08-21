import { useEffect, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { relaunch } from '@tauri-apps/plugin-process';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { IS_DEV, MOBILE_PLATFORM } from '@/lib/env';
import { Logger } from '@/lib/logger';

const logger = new Logger('Updater');

/**
 * Ask the stable channel for a newer release. Desktop-only: the updater and
 * process plugins are registered under #[cfg(desktop)], so there is nothing to
 * call on mobile.
 */
export async function checkForUpdate(): Promise<Update | null> {
  if (MOBILE_PLATFORM !== null) {
    return null;
  }

  try {
    // Dev is pinned to 0.0.0; real versions set by CI
    if ((await getVersion()) === '0.0.0') {
      return null;
    }
    return await check();
  } catch (error) {
    if (!IS_DEV) {
      return null;
    }
    logger.warn('Update check failed', error);
    return null;
  }
}

/** The release waiting to be installed, or null when there is nothing to do. */
export function useUpdate(): Update | null {
  const [update, setUpdate] = useState<Update | null>(null);

  useEffect(() => {
    let cancelled = false;
    void checkForUpdate().then((found) => {
      if (!cancelled) {
        setUpdate(found);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return update;
}

let inFlight: Promise<void> | null = null;

/**
 * Download and install `update`, reporting download progress as a 0-1
 * fraction, then relaunch into it.
 */
export function installUpdate(
  update: Update,
  onProgress: (fraction: number) => void,
): Promise<void> {
  // The download outlives the button, which unmounts whenever the top-right
  // tab bar changes identity (splitting or closing a pane). Sharing the
  // in-flight promise keeps a remount from starting a second download.
  inFlight ??= download(update, onProgress);
  return inFlight;
}

async function download(
  update: Update,
  onProgress: (fraction: number) => void,
): Promise<void> {
  let downloaded = 0;
  let total = 0;
  try {
    await update.downloadAndInstall((event) => {
      switch (event.event) {
        case 'Started':
          total = event.data.contentLength ?? 0;
          break;
        case 'Progress':
          downloaded += event.data.chunkLength;
          if (total > 0) {
            onProgress(Math.min(downloaded / total, 1));
          }
          break;
        case 'Finished':
          onProgress(1);
          break;
      }
    });
    await relaunch();
  } catch (error) {
    inFlight = null;
    logger.error('Failed to install update', error, {
      version: update.version,
    });
    throw error;
  }
}
