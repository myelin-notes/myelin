import type { NoteSession } from './note-session';

export const FileTypes = ['mcanvas'] as const;
export type FileType = (typeof FileTypes)[number];

export interface VFSFileNode {
  id: string;
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

export interface RepositoryCapabilities {
  polling: boolean;
  liveSync: boolean;
}

export interface YjsSyncSnapshot {
  update: Uint8Array | null;
  stateVector: Uint8Array;
  revision: string | null;
}

export interface YjsSyncPushOptions {
  baseRevision: string | null;
  localStateVector?: Uint8Array | null;
}

export interface YjsSyncPushResult extends YjsSyncSnapshot {
  accepted: boolean;
  remoteUpdate: Uint8Array | null;
}

export interface YjsSyncTarget {
  loadDocument(nodeId: string): Promise<YjsSyncSnapshot>;
  pullUpdates(
    nodeId: string,
    stateVector?: Uint8Array | null,
  ): Promise<YjsSyncSnapshot>;
  pushUpdates(
    nodeId: string,
    update: Uint8Array,
    options: YjsSyncPushOptions,
  ): Promise<YjsSyncPushResult>;
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
  getUniqueFileName(baseName: string, parentId: string | null): Promise<string>;
  createFolder(name: string, parentId: string | null): Promise<string>;
  createFile(
    name: string,
    fileType: FileType,
    parentId: string | null,
  ): Promise<string>;
  renameNode(nodeId: string, newName: string): Promise<void>;
  deleteNode(nodeId: string): Promise<void>;
  moveNode(nodeId: string, newParentId: string | null): Promise<void>;
  setTags(nodeId: string, tags: string[]): Promise<void>;
  addTag(nodeId: string, tag: string): Promise<void>;
  removeTag(nodeId: string, tag: string): Promise<void>;

  openSession(nodeId: string): Promise<NoteSession>;
}

export interface NoteSessionStatus {
  phase: 'idle' | 'pulling' | 'pushing' | 'closed';
  lastError: Error | null;
  lastSyncedAt: number | null;
  remoteRevision: string | null;
}

export type { NoteSession };
