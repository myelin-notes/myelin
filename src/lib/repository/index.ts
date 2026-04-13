import { LocalNoteStore } from './local/note-store';
import { LocalRepository } from './local/repository';
import { LocalStorageBackend } from './local/storage-backend';

const backend = new LocalStorageBackend();

export const repository = new LocalRepository(backend);
export const noteStore = new LocalNoteStore(backend);

export type {
  FileType,
  NoteSession,
  NoteSessionStatus,
  NoteStore,
  Repository,
  RepositoryCapabilities,
  RepositoryStats,
  RepositoryTag,
  VFSFileNode,
  VFSFolderNode,
  VFSNode,
} from './types';
export { FileTypes } from './types';
