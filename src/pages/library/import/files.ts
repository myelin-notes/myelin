import type { Repository, VFSNodeId } from '@/lib/sync';
import {
  getFileTypeForName,
  ImportableFileTypes,
  isImportableFileType,
} from '@/lib/sync';

export const STORAGE_FILE_ACCEPT = ImportableFileTypes.map(
  (extension) => `.${extension}`,
).join(',');

export function isStorageFile(file: File): boolean {
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
