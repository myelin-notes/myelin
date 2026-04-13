import { LocalStorageRepository } from './local-storage-repository';

export const repository = new LocalStorageRepository();

export type {
  FileType,
  Repository,
  RepositoryCapabilities,
  RepositoryNoteHandle,
  RepositoryStats,
  RepositoryTag,
  VFSFileNode,
  VFSFolderNode,
  VFSNode,
} from './types';
export { FileTypes } from './types';
