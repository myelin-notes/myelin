import type { FolderReader } from '@/lib/folder-reader';
import type { FileType, NativeRepository, VFSNodeId } from '@/lib/sync';
import { getFileTypeForName, isImportableFileType } from '@/lib/sync';

export function isStorageFile(file: Pick<File, 'name' | 'type'>): boolean {
  const fileType = getFileTypeForName(file.name);
  return fileType !== null && isImportableFileType(fileType);
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
  repository: NativeRepository;
  parentId: VFSNodeId | null;
  reader?: FolderReader;
}): Promise<VFSNodeId> {
  return repository.importFile(
    name,
    fileType,
    parentId,
    reader ? reader.importSource(path) : { kind: 'path', path },
  );
}
