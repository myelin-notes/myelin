import { LocalRepository } from './local/repository';

export const repository = new LocalRepository();

export type {
  FileType,
  NoteSession,
  NoteSessionStatus,
  Repository,
  RepositoryCapabilities,
  RepositoryStats,
  RepositoryTag,
  VFSFileNode,
  VFSFolderNode,
  VFSNode,
  YjsSyncPushOptions,
  YjsSyncPushResult,
  YjsSyncSnapshot,
  YjsSyncTarget,
} from './types';
export { FileTypes } from './types';
