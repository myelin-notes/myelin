import type {
  FileType,
  NodeSearchResult,
  RepositoryConfig,
  VFSFileNode,
  VFSFolderNode,
  VFSNode,
  VFSNodeId,
} from '@/lib/sync';
import {
  isRepositoryConfigStructurallyComplete,
  isRepositoryFullyConfigured,
} from '@/lib/sync/repo/readiness';
import { nodeMatchesAnyTag } from '@/lib/sync/repo/tag-hierarchy';

export type ExplorerSortMode =
  | 'name-asc'
  | 'name-desc'
  | 'modified'
  | 'created';

export type ExplorerSearchMode = 'lexical' | 'semantic';

export type ExplorerSetupState = 'checking' | 'ready' | 'setup-required';

export interface ExplorerRepository {
  getNode(nodeId: VFSNodeId): Promise<VFSNode | null>;
  listDirectory(
    folderId: VFSNodeId | null,
  ): Promise<[VFSFolderNode[], VFSFileNode[]]>;
  getFolderChain(folderId: VFSNodeId | null): Promise<VFSFolderNode[]>;
  searchNodes(
    query: string,
    options?: { mode?: ExplorerSearchMode },
  ): Promise<NodeSearchResult[]>;
  getNodesByAnyTag(
    tags: string[],
    folderId?: VFSNodeId | null,
  ): Promise<VFSNode[]>;
  getUniqueFileName(
    baseName: string,
    parentId: VFSNodeId | null,
  ): Promise<string>;
  createFolder(name: string, parentId: VFSNodeId | null): Promise<VFSNodeId>;
  createFile(
    name: string,
    fileType: FileType,
    parentId: VFSNodeId | null,
  ): Promise<VFSNodeId>;
}

export type ExplorerCanvasFileCreator = (
  name: string,
  parentId: VFSNodeId | null,
) => Promise<VFSNodeId>;

export interface ExplorerQuery {
  folderId: VFSNodeId | null;
  searchQuery: string;
  searchMode: ExplorerSearchMode;
  filterTags: readonly string[];
}

export interface ExplorerQueryResult {
  requestId: number;
  nodes: VFSNode[];
  searchMatches: ReadonlyMap<VFSNodeId, NodeSearchResult>;
}

export function getInitialExplorerSetupState(
  config: RepositoryConfig,
): ExplorerSetupState {
  if (config.kind === 'local') {
    return 'ready';
  }
  return isRepositoryConfigStructurallyComplete(config)
    ? 'checking'
    : 'setup-required';
}

export async function resolveExplorerSetupState(
  config: RepositoryConfig,
): Promise<ExplorerSetupState> {
  const initial = getInitialExplorerSetupState(config);
  if (initial !== 'checking') {
    return initial;
  }
  return (await isRepositoryFullyConfigured(config))
    ? 'ready'
    : 'setup-required';
}

export function compareExplorerNodes(
  left: VFSNode,
  right: VFSNode,
  sortMode: ExplorerSortMode,
): number {
  if (left.type !== right.type) {
    return left.type === 'folder' ? -1 : 1;
  }
  switch (sortMode) {
    case 'name-asc':
      return left.name.localeCompare(right.name);
    case 'name-desc':
      return right.name.localeCompare(left.name);
    case 'modified':
      return right.modifiedAt - left.modifiedAt;
    case 'created':
      return right.createdAt - left.createdAt;
  }
}

export function sortExplorerNodes(
  nodes: readonly VFSNode[],
  sortMode: ExplorerSortMode,
): VFSNode[] {
  return [...nodes].sort((left, right) =>
    compareExplorerNodes(left, right, sortMode),
  );
}

export class ExplorerModel {
  private requestId = 0;

  constructor(
    private readonly repository: ExplorerRepository,
    private readonly createCanvasFile: ExplorerCanvasFileCreator,
  ) {}

  invalidatePendingRequests(): void {
    this.requestId += 1;
  }

  isCurrent(result: ExplorerQueryResult): boolean {
    return result.requestId === this.requestId;
  }

  async refresh(query: ExplorerQuery): Promise<ExplorerQueryResult | null> {
    const requestId = this.requestId + 1;
    this.requestId = requestId;
    const searchQuery = query.searchQuery.trim();
    try {
      let nodes: VFSNode[];
      let searchMatches: ReadonlyMap<VFSNodeId, NodeSearchResult> = new Map();

      if (searchQuery) {
        let results = await this.repository.searchNodes(searchQuery, {
          mode: query.searchMode,
        });
        if (query.filterTags.length > 0) {
          results = results.filter((result) =>
            nodeMatchesAnyTag(result.node.tags, query.filterTags),
          );
        }
        nodes = results.map((result) => result.node);
        searchMatches = new Map(
          results.map((result) => [result.node.id, result]),
        );
      } else if (query.filterTags.length > 0) {
        nodes = await this.repository.getNodesByAnyTag(
          [...query.filterTags],
          query.folderId,
        );
      } else {
        const [folders, files] = await this.repository.listDirectory(
          query.folderId,
        );
        nodes = [...folders, ...files];
      }

      return requestId === this.requestId
        ? { requestId, nodes, searchMatches }
        : null;
    } catch (error) {
      if (requestId !== this.requestId) {
        return null;
      }
      throw error;
    }
  }

  async loadFolder(folderId: VFSNodeId | null): Promise<VFSNode[]> {
    const [folders, files] = await this.repository.listDirectory(folderId);
    return [...folders, ...files];
  }

  async loadAncestors(nodes: readonly VFSNode[]): Promise<VFSFolderNode[]> {
    const parentIds = new Set(
      nodes
        .map((node) => node.parentId)
        .filter((id): id is VFSNodeId => id !== null),
    );
    const chains = await Promise.all(
      [...parentIds].map((parentId) =>
        this.repository.getFolderChain(parentId),
      ),
    );
    return chains.flat();
  }

  async createFolder(
    parentId: VFSNodeId | null,
    defaultName: string,
  ): Promise<VFSFolderNode> {
    const name = await this.repository.getUniqueFileName(defaultName, parentId);
    const id = await this.repository.createFolder(name, parentId);
    const node = await this.repository.getNode(id);
    if (!node || node.type !== 'folder') {
      throw new Error(`Created folder is missing: ${id}`);
    }
    this.invalidatePendingRequests();
    return node;
  }

  async createFile(
    parentId: VFSNodeId | null,
    title: string,
    fileType: FileType,
  ): Promise<VFSFileNode> {
    const name = await this.repository.getUniqueFileName(title, parentId);
    const id =
      fileType === 'mcanvas'
        ? await this.createCanvasFile(name, parentId)
        : await this.repository.createFile(name, fileType, parentId);
    const node = await this.repository.getNode(id);
    if (!node || node.type !== 'file') {
      throw new Error(`Created file is missing: ${id}`);
    }
    this.invalidatePendingRequests();
    return node;
  }
}
