import { LocalRepository } from './local/repository';

export const repository = new LocalRepository();

export type { NoteSession } from './note-session';
export type {
  FileType,
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
