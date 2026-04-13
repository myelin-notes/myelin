import type { YDocManager } from '@/pages/free-canvas/ydoc-manager';

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
  revealOnDisk: boolean;
  polling: boolean;
  liveSync: boolean;
}

export interface Repository {
  readonly kind: string;

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
}

export interface NoteSessionStatus {
  phase: 'idle' | 'refreshing' | 'flushing' | 'closed';
  lastError: Error | null;
  lastSyncedAt: number | null;
  remoteRevision: string | null;
}

export interface NoteSession {
  readonly id: string;
  readonly ydoc: YDocManager;
  readonly status: NoteSessionStatus;
  refresh(): Promise<void>;
  flush(): Promise<void>;
  close(): Promise<void>;
}

export interface NoteStore {
  readonly kind: string;
  readonly capabilities: RepositoryCapabilities;

  openSession(nodeId: string): Promise<NoteSession>;
  getRevealPath(nodeId: string): Promise<string | null>;
}
