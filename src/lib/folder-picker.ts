import {
  type FolderHandle,
  isScopedStorageError,
  pickFolder as pickScopedFolder,
} from 'tauri-plugin-scoped-storage-api';
import { open } from '@tauri-apps/plugin-dialog';
import { MOBILE_PLATFORM } from './env';

export type PickedFolder =
  | { kind: 'native'; path: string }
  | { kind: 'scoped'; handle: FolderHandle };

/** Returns null when the user cancels. Mobile handles are not filesystem paths. */
export async function pickFolder(): Promise<PickedFolder | null> {
  if (MOBILE_PLATFORM === 'ios' || MOBILE_PLATFORM === 'android') {
    try {
      return { kind: 'scoped', handle: await pickScopedFolder() };
    } catch (error) {
      if (isScopedStorageError(error) && error.code === 'CANCELLED') {
        return null;
      }
      throw error;
    }
  }

  const path = await open({
    directory: true,
    multiple: false,
    recursive: true,
  });
  return path === null ? null : { kind: 'native', path };
}
