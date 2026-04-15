import { LocalRepository } from './repo/local';

export const repository = new LocalRepository();

export { NoteSession } from './session';
export { noopTransport, type Transport } from './live/transport';

export type {
  FileType,
  Repository,
  RepositoryCapabilities,
  RepositoryStats,
  RepositoryTag,
  VFSFileNode,
  VFSFolderNode,
  VFSNode,
} from './repo/types';
export { FileTypes } from './repo/types';

export type {
  NoteSessionStatus,
  YjsSyncPushOptions,
  YjsSyncPushResult,
  YjsSyncSnapshot,
  YjsSyncTarget,
} from './types';
