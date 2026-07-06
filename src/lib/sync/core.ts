/**
 * Tauri-free subset of the sync barrel: pure types and helpers with no
 * transitive host dependencies. Editor code must import from here (or the
 * underlying modules) rather than `@/lib/sync`, whose other exports pull in
 * host-only modules (plugin-http clients, repository implementations).
 */

export { noopTransport, type Transport } from './live/transport';
export {
  getFileTypeForName,
  getMimeTypeForFileType,
  isImageFileType,
  isVideoFileType,
} from './repo/shared';
export type {
  FileType,
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
export { FileTypes, ImageFileTypes, VideoFileTypes } from './repo/types';
export type {
  NoteSessionStatus,
  VFSNodeId,
  YjsSyncPushOptions,
  YjsSyncPushResult,
  YjsSyncSnapshot,
  YjsSyncTarget,
} from './types';
