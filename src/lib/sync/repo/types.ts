import type { ReindexItem } from '@/lib/note-index';
import type { NoteSession } from '../session';
import type { VFSNodeId } from '../types';

export type { VFSNodeId } from '../types';

export const ImageFileTypes = [
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'avif',
  'svg',
  'bmp',
] as const;
export const VideoFileTypes = [
  'mp4',
  'mov',
  'm4v',
  'webm',
  'avi',
  'mkv',
] as const;
export const FileTypes = [
  'mcanvas',
  ...ImageFileTypes,
  ...VideoFileTypes,
] as const;
export type FileType = (typeof FileTypes)[number];

export interface VFSFileNode {
  id: VFSNodeId;
  name: string;
  type: 'file';
  fileType: FileType;
  parentId: VFSNodeId | null;
  tags: string[];
  createdAt: number;
  modifiedAt: number;
  system?: VFSSystemMetadata;
}

export interface VFSFolderNode {
  id: VFSNodeId;
  name: string;
  type: 'folder';
  parentId: VFSNodeId | null;
  children: VFSNodeId[];
  tags: string[];
  createdAt: number;
  modifiedAt: number;
  system?: VFSSystemMetadata;
}

export type VFSNode = VFSFileNode | VFSFolderNode;

export type VFSSystemMetadata =
  | { kind: 'version-history-root' }
  | {
      kind: 'file-version';
      sourceFileId: VFSNodeId;
      sourceFileType: FileType;
      sourceName: string;
      sourceRevision: string | null;
      capturedAt: number;
      byteLength: number;
    };

export interface CreateFileOptions {
  system?: VFSSystemMetadata;
}

export interface FileVersion {
  id: VFSNodeId;
  sourceFileId: VFSNodeId;
  sourceName: string;
  fileType: FileType;
  sourceRevision: string | null;
  capturedAt: number;
  byteLength: number;
}

export interface RepositoryTag {
  tag: string;
  count: number;
}

export interface RepositoryStats {
  totalFiles: number;
  totalFolders: number;
  totalTags: number;
}

export interface StoredNoteLink {
  targetId: VFSNodeId | null;
  pageFrameId: string | null;
  title: string;
  snippet: string;
}

export interface NoteBacklink extends StoredNoteLink {
  sourceId: VFSNodeId;
  sourceName: string;
}

export interface NodeSearchResult {
  node: VFSNode;
  score: number;
  /** Snippet around the matched indexed content, or null if name/tags matched. */
  contentSnippet: string | null;
  /** Lowercased document terms that matched the query, for highlighting. */
  matchedTerms: string[];
}

export interface RepositoryCapabilities {
  polling: boolean;
  liveSync: boolean;
  batchedCommit: boolean;
}

export interface Repository {
  readonly kind: string;
  readonly capabilities: RepositoryCapabilities;

  getNode(nodeId: VFSNodeId): Promise<VFSNode | null>;
  listDirectory(
    folderId: VFSNodeId | null,
  ): Promise<[VFSFolderNode[], VFSFileNode[]]>;
  getFolderChain(folderId: VFSNodeId | null): Promise<VFSFolderNode[]>;
  searchNodes(query: string): Promise<NodeSearchResult[]>;
  /** Candidate notes for the content-index startup backfill. */
  listIndexBackfillItems(): Promise<ReindexItem[]>;
  getNodesByAnyTag(tags: string[]): Promise<VFSNode[]>;
  listTags(includeAncestors?: boolean): Promise<RepositoryTag[]>;
  getStats(): Promise<RepositoryStats>;
  getRecentFiles(limit?: number): Promise<VFSFileNode[]>;
  getBacklinks(noteId: VFSNodeId): Promise<NoteBacklink[]>;
  getUniqueFileName(
    baseName: string,
    parentId: VFSNodeId | null,
  ): Promise<string>;
  createFolder(name: string, parentId: VFSNodeId | null): Promise<VFSNodeId>;
  createFile(
    name: string,
    fileType: FileType,
    parentId: VFSNodeId | null,
    bytes?: Uint8Array,
    options?: CreateFileOptions,
  ): Promise<VFSNodeId>;
  readFileBytes(nodeId: VFSNodeId): Promise<Uint8Array | null>;
  writeFileBytes(nodeId: VFSNodeId, bytes: Uint8Array): Promise<void>;
  listFileVersions(nodeId: VFSNodeId): Promise<FileVersion[]>;
  createFileVersionIfDue(
    nodeId: VFSNodeId,
    options?: { force?: boolean },
  ): Promise<FileVersion | null>;
  restoreFileVersion(nodeId: VFSNodeId, versionId: VFSNodeId): Promise<void>;
  renameNode(nodeId: VFSNodeId, newName: string): Promise<void>;
  deleteNode(nodeId: VFSNodeId): Promise<void>;
  moveNode(nodeId: VFSNodeId, newParentId: VFSNodeId | null): Promise<void>;
  setTags(nodeId: VFSNodeId, tags: string[]): Promise<void>;
  addTag(nodeId: VFSNodeId, tag: string): Promise<void>;
  removeTag(nodeId: VFSNodeId, tag: string): Promise<void>;
  getRevealPath(nodeId: VFSNodeId): Promise<string | null>;
  /** Absolute on-disk path to a file's stored bytes, or null if not a file. */
  getStoredAbsolutePath(nodeId: VFSNodeId): Promise<string | null>;

  getCustomColors(): Promise<string[]>;
  addCustomColor(color: string): Promise<string[]>;
  removeCustomColor(color: string): Promise<string[]>;

  openSession(nodeId: VFSNodeId): Promise<NoteSession>;
}

export type { NoteSession };
