import * as scoped from 'tauri-plugin-scoped-storage-api';
import { join } from '@tauri-apps/api/path';
import {
  type DirEntry,
  readDir,
  readFile,
  readTextFile,
} from '@tauri-apps/plugin-fs';
import type { PickedFolder } from './folder-picker';

export interface FolderReader {
  root: string;
  join(parent: string, name: string): Promise<string>;
  readDir(path: string): Promise<DirEntry[]>;
  readFile(path: string): Promise<Uint8Array>;
  readTextFile(path: string): Promise<string>;
}

export function createFolderReader(
  folder: PickedFolder | string,
): FolderReader {
  if (typeof folder === 'string' || folder.kind === 'native') {
    return {
      root: typeof folder === 'string' ? folder : folder.path,
      join,
      readDir,
      readFile,
      readTextFile,
    };
  }
  const id = folder.handle.id;
  return {
    root: '',
    join: async (parent, name) => (parent ? `${parent}/${name}` : name),
    readDir: async (path) =>
      (await scoped.readDir(id, path)).map((entry) => ({
        name: entry.name,
        isFile: entry.isFile,
        isDirectory: entry.isDir,
        isSymlink: false,
      })),
    readFile: (path) => scoped.readFile(id, path),
    readTextFile: (path) => scoped.readTextFile(id, path),
  };
}
