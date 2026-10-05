import {
  pickFolder as pickScopedFolder,
  ScopedStorageError,
} from 'tauri-plugin-scoped-storage-api';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { open } from '@tauri-apps/plugin-dialog';
import { pickFolder } from './folder-picker';

const platform = vi.hoisted(() => ({ value: null as string | null }));
vi.mock('./env', () => ({
  get MOBILE_PLATFORM() {
    return platform.value;
  },
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('tauri-plugin-scoped-storage-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('tauri-plugin-scoped-storage-api')>()),
  pickFolder: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  platform.value = null;
});

describe('folder picking', () => {
  it('uses the native desktop dialog with recursive access', async () => {
    vi.mocked(open).mockResolvedValue('/vault');
    expect(await pickFolder()).toEqual({ kind: 'native', path: '/vault' });
    expect(open).toHaveBeenCalledWith({
      directory: true,
      multiple: false,
      recursive: true,
    });
    expect(pickScopedFolder).not.toHaveBeenCalled();
  });

  it.each([
    'ios',
    'android',
  ])('uses scoped storage on %s without treating its URI as a path', async (os) => {
    platform.value = os;
    const handle = {
      id: 'folder-id',
      name: 'Vault',
      uri: 'content://provider/tree/123',
    };
    vi.mocked(pickScopedFolder).mockResolvedValue(handle);
    expect(await pickFolder()).toEqual({ kind: 'scoped', handle });
    expect(open).not.toHaveBeenCalled();
  });

  it('returns null for desktop cancellation', async () => {
    vi.mocked(open).mockResolvedValue(null);
    expect(await pickFolder()).toBeNull();
  });

  it.each([
    'ios',
    'android',
  ])('normalizes cancellation on %s and propagates other errors', async (os) => {
    platform.value = os;
    vi.mocked(pickScopedFolder).mockRejectedValue(
      new ScopedStorageError({ code: 'CANCELLED', message: 'Cancelled' }),
    );
    expect(await pickFolder()).toBeNull();
    const failure = new ScopedStorageError({
      code: 'PERMISSION_DENIED',
      message: 'Denied',
    });
    vi.mocked(pickScopedFolder).mockRejectedValue(failure);
    await expect(pickFolder()).rejects.toBe(failure);
  });
});
