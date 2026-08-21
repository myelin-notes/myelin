import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DownloadEvent, Update } from '@tauri-apps/plugin-updater';

type OnEvent = (event: DownloadEvent) => void;

const getVersion = vi.fn(async () => '1.0.0');
const check = vi.fn();
const relaunch = vi.fn(async () => {});
const downloadAndInstall = vi.fn(async (_onEvent: OnEvent) => {});

vi.mock('@tauri-apps/api/app', () => ({ getVersion: () => getVersion() }));
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: () => relaunch() }));
vi.mock('@tauri-apps/plugin-updater', () => ({ check: () => check() }));

const fakeUpdate = {
  version: '1.2.0',
  downloadAndInstall,
} as unknown as Update;

// installUpdate keeps the in-flight download in module state, so each test
// gets a fresh copy of the module.
async function loadUpdater() {
  vi.resetModules();
  return import('./updater');
}

describe('checkForUpdate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getVersion.mockResolvedValue('1.0.0');
    check.mockResolvedValue(fakeUpdate);
  });

  it('skips dev builds pinned to 0.0.0', async () => {
    getVersion.mockResolvedValue('0.0.0');
    const { checkForUpdate } = await loadUpdater();

    await expect(checkForUpdate()).resolves.toBeNull();
    expect(check).not.toHaveBeenCalled();
  });

  it('returns null when no release is available', async () => {
    check.mockResolvedValue(null);
    const { checkForUpdate } = await loadUpdater();

    await expect(checkForUpdate()).resolves.toBeNull();
  });

  it('returns null when the check throws', async () => {
    check.mockRejectedValue(new Error('offline'));
    const { checkForUpdate } = await loadUpdater();

    await expect(checkForUpdate()).resolves.toBeNull();
  });

  it('returns the available release', async () => {
    const { checkForUpdate } = await loadUpdater();

    await expect(checkForUpdate()).resolves.toBe(fakeUpdate);
  });
});

describe('installUpdate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    downloadAndInstall.mockImplementation(async () => {});
  });

  it('reports progress against the content length, then relaunches', async () => {
    downloadAndInstall.mockImplementation(async (onEvent: OnEvent) => {
      onEvent({ event: 'Started', data: { contentLength: 100 } });
      onEvent({ event: 'Progress', data: { chunkLength: 25 } });
      onEvent({ event: 'Progress', data: { chunkLength: 25 } });
      onEvent({ event: 'Finished' });
    });
    const { installUpdate } = await loadUpdater();
    const progress: number[] = [];

    await installUpdate(fakeUpdate, (fraction) => progress.push(fraction));

    expect(progress).toEqual([0.25, 0.5, 1]);
    expect(relaunch).toHaveBeenCalledTimes(1);
  });

  it('stays silent about progress when the size is unknown', async () => {
    downloadAndInstall.mockImplementation(async (onEvent: OnEvent) => {
      onEvent({ event: 'Started', data: { contentLength: undefined } });
      onEvent({ event: 'Progress', data: { chunkLength: 25 } });
    });
    const { installUpdate } = await loadUpdater();
    const progress: number[] = [];

    await installUpdate(fakeUpdate, (fraction) => progress.push(fraction));

    expect(progress).toEqual([]);
  });

  it('shares one download across concurrent callers', async () => {
    const { installUpdate } = await loadUpdater();

    await Promise.all([
      installUpdate(fakeUpdate, () => {}),
      installUpdate(fakeUpdate, () => {}),
    ]);

    expect(downloadAndInstall).toHaveBeenCalledTimes(1);
    expect(relaunch).toHaveBeenCalledTimes(1);
  });

  it('allows a retry after a failed download', async () => {
    downloadAndInstall.mockRejectedValueOnce(new Error('network down'));
    const { installUpdate } = await loadUpdater();

    await expect(installUpdate(fakeUpdate, () => {})).rejects.toThrow(
      'network down',
    );
    expect(relaunch).not.toHaveBeenCalled();

    await installUpdate(fakeUpdate, () => {});
    expect(downloadAndInstall).toHaveBeenCalledTimes(2);
    expect(relaunch).toHaveBeenCalledTimes(1);
  });
});
