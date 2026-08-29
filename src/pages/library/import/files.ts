import type { Repository, VFSNodeId } from '@/lib/sync';
import {
  DataFileTypes,
  getFileTypeForName,
  ImageFileTypes,
  VideoFileTypes,
} from '@/lib/sync';

export const STORAGE_FILE_ACCEPT = [
  ...ImageFileTypes,
  ...VideoFileTypes,
  ...DataFileTypes,
]
  .map((extension) => `.${extension}`)
  .join(',');

export function isStorageFile(file: File): boolean {
  const fileType = getFileTypeForName(file.name);
  return fileType !== null && fileType !== 'mcanvas';
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
  if (!fileType || fileType === 'mcanvas') {
    throw new Error(`Unsupported file type: ${file.name}`);
  }

  const name = await repository.getUniqueFileName(file.name, parentId);
  const bytes = new Uint8Array(await file.arrayBuffer());
  return repository.createFile(name, fileType, parentId, bytes);
}
