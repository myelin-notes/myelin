import type { ReindexItem } from '../../platform';
import type { VFSNodeId } from '../types';
import type { FileType } from './file-types';

export type { VFSNodeId } from '../types';
export type { FileType } from './file-types';

export type CustomColorTool = 'pen' | 'highlighter' | 'text';

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

export interface RepositoryNoteGraphNode {
  id: VFSNodeId;
  name: string;
  tags: string[];
}

export interface RepositoryNoteGraphLink extends StoredNoteLink {
  sourceId: VFSNodeId;
}

export interface RepositoryNoteGraph {
  nodes: RepositoryNoteGraphNode[];
  links: RepositoryNoteGraphLink[];
}

export interface NodeSearchResult {
  node: VFSNode;
  score: number;
  /** Snippet around the matched indexed content, or null if name/tags matched. */
  contentSnippet: string | null;
  /** Lowercased document terms that matched the query, for highlighting. */
  matchedTerms: string[];
  searchMode?: 'lexical' | 'semantic';
}

export interface SearchNodesOptions {
  mode?: 'lexical' | 'semantic';
  limit?: number;
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
  searchNodes(
    query: string,
    options?: SearchNodesOptions,
  ): Promise<NodeSearchResult[]>;
  /**
   * Exact-name match excluding system nodes. Note-link resolution needs this rather than a fuzzy
   * search, so it must not pay to rebuild a MiniSearch index on every document change.
   */
  getNodesByName(name: string): Promise<VFSNode[]>;
  /** Candidate notes for the content-index startup backfill. */
  listIndexBackfillItems(): Promise<ReindexItem[]>;
  getNodesByAnyTag(
    tags: string[],
    folderId?: VFSNodeId | null,
  ): Promise<VFSNode[]>;
  listTags(includeAncestors?: boolean): Promise<RepositoryTag[]>;
  getStats(): Promise<RepositoryStats>;
  getRecentFiles(limit?: number): Promise<VFSFileNode[]>;
  getBacklinks(noteId: VFSNodeId): Promise<NoteBacklink[]>;
  getNoteGraph(): Promise<RepositoryNoteGraph>;
  getUniqueFileName(
    baseName: string,
    parentId: VFSNodeId | null,
  ): Promise<string>;
  createFolder(name: string, parentId: VFSNodeId | null): Promise<VFSNodeId>;
  /** Child ids including system nodes, which `listDirectory` filters out. */
  listChildIds(folderId: VFSNodeId | null): Promise<readonly VFSNodeId[]>;
  createFile(
    name: string,
    fileType: FileType,
    parentId: VFSNodeId | null,
    bytes?: Uint8Array,
    options?: CreateFileOptions,
  ): Promise<VFSNodeId>;
  /**
   * Batches `fn`'s manifest writes onto one manifest, saved once when `fn` resolves. For additive
   * bulk work such as imports — no deletes inside. Reads inside `fn` observe the pending writes.
   */
  batchManifestWrites<T>(fn: () => Promise<T>): Promise<T>;
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

  getCustomColors(tool: CustomColorTool): Promise<string[]>;
  addCustomColor(color: string, tool: CustomColorTool): Promise<string[]>;
  removeCustomColor(color: string, tool: CustomColorTool): Promise<string[]>;

  getRegistryTags(): Promise<string[]>;
  addRegistryTags(tags: string[]): Promise<string[]>;
  removeRegistryTag(tag: string): Promise<string[]>;
}
