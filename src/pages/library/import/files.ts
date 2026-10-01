import { readFile } from '@tauri-apps/plugin-fs';
import type { FolderReader } from '@/lib/folder-reader';
import type { FileType, Repository, VFSNodeId } from '@/lib/sync';
import {
  getFileTypeForName,
  ImportableFileTypes,
  isImportableFileType,
} from '@/lib/sync';

export const STORAGE_FILE_ACCEPT = ImportableFileTypes.map(
  (extension) => `.${extension}`,
).join(',');

export function isStorageFile(file: Pick<File, 'name' | 'type'>): boolean {
  const fileType = getFileTypeForName(file.name);
  return fileType !== null && isImportableFileType(fileType);
}

export async function importStorageFile({
  file,
  repository,
  parentId,
}: {
  file: File;
  repository: Repository;
  parentId: string | null;
}): Promise<VFSNodeId> {
  const fileType = getFileTypeForName(file.name);
  if (!fileType || !isImportableFileType(fileType)) {
    throw new Error(`Unsupported file type: ${file.name}`);
  }

  const name = await repository.getUniqueFileName(file.name, parentId);
  const bytes = new Uint8Array(await file.arrayBuffer());
  return repository.createFile(name, fileType, parentId, bytes);
}

export async function importStoragePath({
  path,
  name,
  fileType,
  repository,
  parentId,
  reader,
}: {
  path: string;
  name: string;
  fileType: FileType;
  repository: Repository;
  parentId: VFSNodeId | null;
  reader?: FolderReader;
}): Promise<VFSNodeId> {
  const nativePath = reader ? reader.nativePath(path) : path;
  if (nativePath !== null && repository.importFileFromPath) {
    return repository.importFileFromPath(name, fileType, parentId, nativePath);
  }
  const bytes = reader ? await reader.readFile(path) : await readFile(path);
  return repository.createFile(name, fileType, parentId, bytes);
}
