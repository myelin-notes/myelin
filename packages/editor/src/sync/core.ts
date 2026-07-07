/**
 * Pure sync types and helpers the editor depends on: the VFS/Repository
 * contract, Yjs sync types, the live transport interface, and file-type
 * helpers. No host or app dependencies.
 */

export { noopTransport, type Transport } from './live/transport';
export {
  type FileType,
  FileTypes,
  getFileTypeForName,
  getMimeTypeForFileType,
  ImageFileTypes,
  isImageFileType,
  isVideoFileType,
  VideoFileTypes,
} from './repo/file-types';
export type {
  FileVersion,
  NodeSearchResult,
  NoteBacklink,
  Repository,
  RepositoryCapabilities,
  RepositoryNoteGraph,
  RepositoryNoteGraphLink,
  RepositoryNoteGraphNode,
  RepositoryStats,
  RepositoryTag,
  SearchNodesOptions,
  StoredNoteLink,
  VFSFileNode,
  VFSFolderNode,
  VFSNode,
} from './repo/types';
export type {
  NoteSessionStatus,
  VFSNodeId,
  YjsSyncPushOptions,
  YjsSyncPushResult,
  YjsSyncSnapshot,
  YjsSyncTarget,
} from './types';
