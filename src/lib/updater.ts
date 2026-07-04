import { getVersion } from '@tauri-apps/api/app';
import { ask } from '@tauri-apps/plugin-dialog';
import { relaunch } from '@tauri-apps/plugin-process';
import { check } from '@tauri-apps/plugin-updater';

/**
 * Check the stable channel for a newer release and, if the user agrees,
 * download + install it and relaunch. Desktop-only: the updater plugin is
 * not registered on mobile, so check() throws there and we silently skip.
 */
export async function initAutoUpdate(): Promise<void> {
  try {
    // The repo's version is pinned to 0.0.0; real versions are stamped in by
    // CI from the release tag. Anything still at 0.0.0 is a dev/local build,
    // and every published release would register as an "update" for it.
    if ((await getVersion()) === '0.0.0') {
      return;
    }

    const update = await check();
    if (!update) {
      return;
    }

    const wantsUpdate = await ask(
      `Myelin ${update.version} is available. Download and install it now?`,
      { title: 'Update available', kind: 'info' },
    );
    if (!wantsUpdate) {
      return;
    }

    await update.downloadAndInstall();
    await relaunch();
  } catch (error) {
    // No updater on this platform, offline, or no release published yet.
    // Auto-update is best-effort; never block app startup on it.
    if (import.meta.env.DEV) {
      console.warn('Auto-update check failed:', error);
    }
  }
}
