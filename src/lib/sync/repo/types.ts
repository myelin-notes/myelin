import type { NoteSession } from '../session';
import type { FileId } from '../types';

export type { FileId } from '../types';

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
  id: FileId;
  name: string;
  type: 'file';
  fileType: FileType;
  parentId: string | null;
  tags: string[];
  createdAt: number;
  modifiedAt: number;
}

export interface VFSFolderNode {
  id: string;
  name: string;
  type: 'folder';
  parentId: string | null;
  children: string[];
  tags: string[];
  createdAt: number;
  modifiedAt: number;
}

export type VFSNode = VFSFileNode | VFSFolderNode;

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
  targetId: FileId | null;
  title: string;
  snippet: string;
}

export interface NoteBacklink extends StoredNoteLink {
  sourceId: FileId;
  sourceName: string;
}

export interface RepositoryCapabilities {
  polling: boolean;
  liveSync: boolean;
}

export interface Repository {
  readonly kind: string;
  readonly capabilities: RepositoryCapabilities;

  getNode(nodeId: string): Promise<VFSNode | null>;
  listDirectory(
    folderId: string | null,
  ): Promise<[VFSFolderNode[], VFSFileNode[]]>;
  getFolderChain(folderId: string | null): Promise<VFSFolderNode[]>;
  searchNodes(query: string): Promise<VFSNode[]>;
  getNodesByAnyTag(tags: string[]): Promise<VFSNode[]>;
  listTags(): Promise<RepositoryTag[]>;
  getStats(): Promise<RepositoryStats>;
  getRecentFiles(limit?: number): Promise<VFSFileNode[]>;
  getBacklinks(noteId: FileId): Promise<NoteBacklink[]>;
  getUniqueFileName(baseName: string, parentId: string | null): Promise<string>;
  createFolder(name: string, parentId: string | null): Promise<string>;
  createFile(
    name: string,
    fileType: FileType,
    parentId: string | null,
    bytes?: Uint8Array,
  ): Promise<FileId>;
  readFileBytes(nodeId: FileId): Promise<Uint8Array | null>;
  writeFileBytes(nodeId: FileId, bytes: Uint8Array): Promise<void>;
  renameNode(nodeId: string, newName: string): Promise<void>;
  deleteNode(nodeId: string): Promise<void>;
  moveNode(nodeId: string, newParentId: string | null): Promise<void>;
  setTags(nodeId: string, tags: string[]): Promise<void>;
  addTag(nodeId: string, tag: string): Promise<void>;
  removeTag(nodeId: string, tag: string): Promise<void>;
  getRevealPath(nodeId: FileId): Promise<string | null>;

  getCustomColors(): Promise<string[]>;
  addCustomColor(color: string): Promise<string[]>;
  removeCustomColor(color: string): Promise<string[]>;

  openSession(nodeId: FileId): Promise<NoteSession>;
}

export type { NoteSession };
