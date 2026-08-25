import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useMessages } from '@myelin/editor/i18n';
import { cn } from '@myelin/editor/utils';
import { Logger } from '@myelin/shared/logger';
import { createBlankCanvasFile } from '@/lib/note/create';
import {
  type FileType,
  isRepositoryConfigStructurallyComplete,
  isRepositoryFullyConfigured,
  type RepositoryConfig,
  type SearchNodesOptions,
  useRepository,
  useRepositoryStatus,
  type VFSFolderNode,
  type VFSNode,
} from '@/lib/sync';
import { nodeMatchesAnyTag } from '@/lib/sync/repo/tag-hierarchy';
import { useDropTarget } from '@/pages/library/explorer/use-drop-target';
import { buildResultTree, type ResultTreeNode } from './result-tree';
import { SidebarFileRow, SidebarFolderRow } from './tree-rows';

const logger = new Logger('SidebarTree');
const SEARCH_DEBOUNCE_MS = 150;
const ROOT_KEY: string | null = null;
const NO_COLLAPSED_IDS: ReadonlySet<string> = new Set();

export type SortMode = 'name-asc' | 'name-desc' | 'modified' | 'created';
export type SearchMode = NonNullable<SearchNodesOptions['mode']>;

export interface SidebarTreeHandle {
  reload: () => Promise<void>;
  startNewFolder: () => Promise<void>;
  startNewFile: (title: string, type: FileType) => Promise<void>;
}

type RepositorySetupState = 'checking' | 'ready' | 'setup-required';

function getInitialRepositorySetupState(
  config: RepositoryConfig,
): RepositorySetupState {
  if (config.kind === 'local') {
    return 'ready';
  }
  return isRepositoryConfigStructurallyComplete(config)
    ? 'checking'
    : 'setup-required';
}

function compareNodes(a: VFSNode, b: VFSNode, sortMode: SortMode): number {
  if (a.type !== b.type) {
    return a.type === 'folder' ? -1 : 1;
  }
  switch (sortMode) {
    case 'name-asc':
      return a.name.localeCompare(b.name);
    case 'name-desc':
      return b.name.localeCompare(a.name);
    case 'modified':
      return b.modifiedAt - a.modifiedAt;
    case 'created':
      return b.createdAt - a.createdAt;
    default:
      return 0;
  }
}

function sortNodes(nodes: VFSNode[], sortMode: SortMode): VFSNode[] {
  return [...nodes].sort((a, b) => compareNodes(a, b, sortMode));
}

interface FlatResults {
  nodes: VFSNode[];
  /** Parent chains of every node in `nodes`, so the hierarchy can be rebuilt. */
  ancestors: VFSFolderNode[];
}

const EMPTY_RESULTS: FlatResults = { nodes: [], ancestors: [] };

interface SidebarTreeProps {
  ref?: React.Ref<SidebarTreeHandle>;
  sortMode: SortMode;
  searchQuery: string;
  searchMode: SearchMode;
  filterTags: string[];
  /** Notified after a row edit (rename/move/delete) so the sidebar can refresh
   * its tag counts and file total alongside the tree. */
  onChanged?: () => void;
}

export function SidebarTree({
  ref,
  sortMode,
  searchQuery,
  searchMode,
  filterTags,
  onChanged,
}: SidebarTreeProps) {
  const strings = useMessages();
  const repository = useRepository();
  const repositoryStatus = useRepositoryStatus();
  const [setupState, setSetupState] = useState<RepositorySetupState>(() =>
    getInitialRepositorySetupState(repositoryStatus.config),
  );
  const [childrenMap, setChildrenMap] = useState<Map<string | null, VFSNode[]>>(
    () => new Map(),
  );
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [searchResults, setSearchResults] =
    useState<FlatResults>(EMPTY_RESULTS);
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;

  const trimmedQuery = searchQuery.trim();
  const isSearching = trimmedQuery.length > 0;
  const isFiltering = filterTags.length > 0;
  const isFlat = isSearching || isFiltering;
  const ready = setupState === 'ready';

  // Result folders start expanded; collapsing is remembered only for as long as
  // the query and tag filter stay put.
  const resultKey = `${trimmedQuery}\u0000${filterTags.join('\u0000')}`;
  const [collapsedResults, setCollapsedResults] = useState<{
    key: string;
    ids: ReadonlySet<string>;
  }>({ key: resultKey, ids: NO_COLLAPSED_IDS });
  const collapsedIds =
    collapsedResults.key === resultKey
      ? collapsedResults.ids
      : NO_COLLAPSED_IDS;

  useEffect(() => {
    let cancelled = false;
    const config = repositoryStatus.config;

    if (config.kind === 'local') {
      setSetupState('ready');
      return;
    }
    if (!isRepositoryConfigStructurallyComplete(config)) {
      setSetupState('setup-required');
      return;
    }

    setSetupState('checking');
    void isRepositoryFullyConfigured(config).then((configured) => {
      if (!cancelled) {
        setSetupState(configured ? 'ready' : 'setup-required');
      }
    });

    return () => {
      cancelled = true;
    };
  }, [repositoryStatus.config]);

  const loadFolder = useCallback(
    async (folderId: string | null) => {
      const [dirs, files] = await repository.listDirectory(folderId);
      const nodes: VFSNode[] = [...dirs, ...files];
      setChildrenMap((prev) => {
        const next = new Map(prev);
        next.set(folderId, nodes);
        return next;
      });
    },
    [repository],
  );

  const reload = useCallback(async () => {
    if (!ready) {
      setChildrenMap(new Map());
      return;
    }
    const folderIds: (string | null)[] = [ROOT_KEY, ...expandedRef.current];
    await Promise.all(
      folderIds.map((id) =>
        loadFolder(id).catch((err) => {
          logger.error('Failed to load folder', err, { folderId: id });
        }),
      ),
    );
  }, [loadFolder, ready]);

  const loadAncestors = useCallback(
    async (nodes: VFSNode[]): Promise<VFSFolderNode[]> => {
      const parentIds = new Set(
        nodes
          .map((node) => node.parentId)
          .filter((id): id is string => id !== null),
      );
      const chains = await Promise.all(
        [...parentIds].map((id) => repository.getFolderChain(id)),
      );
      return chains.flat();
    },
    [repository],
  );

  const loadFlatResults = useCallback(async () => {
    if (!ready) {
      setSearchResults(EMPTY_RESULTS);
      return;
    }
    try {
      let nodes: VFSNode[];
      if (isSearching) {
        let results = await repository.searchNodes(trimmedQuery, {
          mode: searchMode,
        });
        if (isFiltering) {
          results = results.filter((r) =>
            nodeMatchesAnyTag(r.node.tags, filterTags),
          );
        }
        nodes = results.map((result) => result.node);
      } else {
        nodes = await repository.getNodesByAnyTag(filterTags, ROOT_KEY);
      }
      setSearchResults({ nodes, ancestors: await loadAncestors(nodes) });
    } catch (err) {
      logger.error('Failed to load search results', err);
    }
  }, [
    filterTags,
    isFiltering,
    isSearching,
    loadAncestors,
    ready,
    repository,
    searchMode,
    trimmedQuery,
  ]);

  // Nested tree load (root + expanded) when not in search/filter mode. Also
  // re-runs when a remote sync lands or any local repository mutation occurs
  // (create/rename/delete/move/tag/write) — including changes made outside the
  // sidebar, such as the tab bar creating a file for a new tab. `dataVersion`
  // is the only refresh signal for local repos, where `lastRemoteSyncAt` stays
  // null.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the sync/version values are change triggers
  useEffect(() => {
    if (isFlat) {
      return;
    }
    void reload();
  }, [
    isFlat,
    reload,
    repositoryStatus.lastRemoteSyncAt,
    repositoryStatus.dataVersion,
  ]);

  // Flat search/filter results, debounced for live typing. Re-runs on the same
  // change signals as the nested load above.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the sync/version values are change triggers
  useEffect(() => {
    if (!isFlat) {
      return;
    }
    if (!isSearching) {
      void loadFlatResults();
      return;
    }
    const timer = window.setTimeout(
      () => void loadFlatResults(),
      SEARCH_DEBOUNCE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [
    isFlat,
    isSearching,
    loadFlatResults,
    repositoryStatus.lastRemoteSyncAt,
    repositoryStatus.dataVersion,
  ]);

  const toggle = useCallback(
    (folderId: string) => {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(folderId)) {
          next.delete(folderId);
        } else {
          next.add(folderId);
          void loadFolder(folderId).catch((err) => {
            logger.error('Failed to expand folder', err, { folderId });
          });
        }
        return next;
      });
    },
    [loadFolder],
  );

  const startNewFolder = useCallback(async () => {
    const name = await repository.getUniqueFileName(
      strings.library.createNew.unnamedFolder,
      ROOT_KEY,
    );
    const id = await repository.createFolder(name, ROOT_KEY);
    setRenamingId(id);
    await loadFolder(ROOT_KEY);
    requestAnimationFrame(() => setRenamingId(null));
  }, [loadFolder, repository, strings.library.createNew.unnamedFolder]);

  const startNewFile = useCallback(
    async (title: string, type: FileType) => {
      const name = await repository.getUniqueFileName(title, ROOT_KEY);
      const id =
        type === 'mcanvas'
          ? await createBlankCanvasFile(repository, name, ROOT_KEY)
          : await repository.createFile(name, type, ROOT_KEY);
      setRenamingId(id);
      await loadFolder(ROOT_KEY);
      requestAnimationFrame(() => setRenamingId(null));
    },
    [loadFolder, repository],
  );

  useImperativeHandle(ref, () => ({ reload, startNewFolder, startNewFile }), [
    reload,
    startNewFolder,
    startNewFile,
  ]);

  const notifyNested = useCallback(() => {
    void reload();
    onChanged?.();
  }, [reload, onChanged]);

  const notifyFlat = useCallback(() => {
    void loadFlatResults();
    onChanged?.();
  }, [loadFlatResults, onChanged]);

  const { dragOver: rootDragOver, dropTargetProps: rootDropProps } =
    useDropTarget({ targetFolderId: ROOT_KEY, onMoved: notifyNested });

  const renderNodes = useCallback(
    (nodes: VFSNode[], depth: number): React.ReactNode[] => {
      return sortNodes(nodes, sortMode).flatMap((node) => {
        if (node.type === 'folder') {
          const isExpanded = expanded.has(node.id);
          const children = childrenMap.get(node.id) ?? [];
          return [
            <SidebarFolderRow
              key={node.id}
              node={node}
              depth={depth}
              expanded={isExpanded}
              autoRename={node.id === renamingId}
              onToggle={() => toggle(node.id)}
              onChanged={notifyNested}
            />,
            ...(isExpanded ? renderNodes(children, depth + 1) : []),
          ];
        }
        return [
          <SidebarFileRow
            key={node.id}
            node={node}
            depth={depth}
            autoRename={node.id === renamingId}
            onChanged={notifyNested}
          />,
        ];
      });
    },
    [childrenMap, expanded, renamingId, notifyNested, sortMode, toggle],
  );

  const toggleResultFolder = useCallback(
    (folderId: string) => {
      setCollapsedResults((prev) => {
        const ids = new Set(prev.key === resultKey ? prev.ids : []);
        if (!ids.delete(folderId)) {
          ids.add(folderId);
        }
        return { key: resultKey, ids };
      });
    },
    [resultKey],
  );

  const resultTree = useMemo(() => {
    if (!isFlat) {
      return null;
    }
    return buildResultTree(
      searchResults.nodes,
      searchResults.ancestors,
      (nodes) =>
        isSearching
          ? nodes.sort((a, b) => a.rank - b.rank)
          : nodes.sort((a, b) => compareNodes(a.node, b.node, sortMode)),
    );
  }, [isFlat, isSearching, searchResults, sortMode]);

  const renderResultNodes = useCallback(
    (nodes: ResultTreeNode[], depth: number): React.ReactNode[] => {
      return nodes.flatMap(({ node, children }) => {
        if (node.type === 'folder') {
          const isExpanded = !collapsedIds.has(node.id);
          return [
            <SidebarFolderRow
              key={node.id}
              node={node}
              depth={depth}
              expanded={isExpanded}
              autoRename={false}
              onToggle={() => toggleResultFolder(node.id)}
              onChanged={notifyFlat}
            />,
            ...(isExpanded ? renderResultNodes(children, depth + 1) : []),
          ];
        }
        return [
          <SidebarFileRow
            key={node.id}
            node={node}
            depth={depth}
            autoRename={false}
            onChanged={notifyFlat}
          />,
        ];
      });
    },
    [collapsedIds, notifyFlat, toggleResultFolder],
  );

  if (!ready) {
    return null;
  }

  const rootNodes = childrenMap.get(ROOT_KEY) ?? [];
  const rows = isFlat
    ? renderResultNodes(resultTree ?? [], 0)
    : renderNodes(rootNodes, 0);
  const emptyMessage = isSearching
    ? strings.library.explorerTree.emptySearch
    : isFiltering
      ? strings.library.explorerTree.emptyFilter
      : strings.library.explorerTree.emptyDefault;

  return (
    <div
      className={cn(
        'flex min-h-full flex-col gap-0.5 rounded-md transition-colors duration-150',
        !isFlat && rootDragOver && 'bg-accent/10 ring-1 ring-accent/30',
      )}
      {...(isFlat ? {} : rootDropProps)}
    >
      {rows.length === 0 ? (
        <p className="px-2 py-1 text-text-muted text-xs italic">
          {emptyMessage}
        </p>
      ) : (
        rows
      )}
    </div>
  );
}
