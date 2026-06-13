import {
  type RefObject,
  useCallback,
  useEffect,
  useEffectEvent,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { VirtualGrid } from '@/components/virtual-grid';
import { VirtualList } from '@/components/virtual-list';
import { useMessages } from '@/lib/i18n';
import { Logger } from '@/lib/logger';
import {
  type FileType,
  isRepositoryConfigStructurallyComplete,
  isRepositoryFullyConfigured,
  type NodeSearchResult,
  type RepositoryConfig,
  type SearchNodesOptions,
  useRepository,
  useRepositoryStatus,
  type VFSNode,
} from '@/lib/sync';
import { nodeMatchesAnyTag } from '@/lib/sync/repo/tag-hierarchy';
import { cn } from '@/lib/utils';
import { FileItem } from './file-item';
import { FolderItem } from './folder-item';
import { GridFileItem } from './grid/file-item';
import { GridFolderItem } from './grid/folder-item';
import { useDropTarget } from './use-drop-target';

const logger = new Logger('ExplorerTree');
const SEARCH_DEBOUNCE_MS = 150;
const EMPTY_SEARCH_MATCHES: ReadonlyMap<string, NodeSearchResult> = new Map();

// Grid layout matches `repeat(auto-fill, minmax(198px, 1fr))` with a 16px gap.
const GRID_MIN_COLUMN = 198;
const GRID_GAP = 16;
const TREE_GAP = 4;

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

export interface ExplorerTreeHandle {
  reload: () => Promise<void>;
  startNewFolder: () => Promise<void>;
  startNewFile: (title: string, type: FileType) => Promise<void>;
}

export type SortMode = 'name-asc' | 'name-desc' | 'modified' | 'created';
export type ViewMode = 'tree' | 'grid';
export type SearchMode = NonNullable<SearchNodesOptions['mode']>;

interface ExplorerTreeProps {
  ref?: React.Ref<ExplorerTreeHandle>;
  /** Scroll container the list lives inside (the library page's <main>). */
  scrollRef: RefObject<HTMLElement | null>;
  currentFolderId: string | null;
  onNavigate: (folderId: string) => void;
  onChanged?: () => void;
  sortMode?: SortMode;
  viewMode?: ViewMode;
  searchQuery?: string;
  searchMode?: SearchMode;
  filterTags?: string[];
}

export function ExplorerTree({
  scrollRef,
  currentFolderId,
  onNavigate,
  ref,
  onChanged,
  sortMode = 'name-asc',
  viewMode = 'tree',
  searchQuery,
  searchMode = 'lexical',
  filterTags,
}: ExplorerTreeProps) {
  const strings = useMessages();
  const repository = useRepository();
  const repositoryStatus = useRepositoryStatus();
  const [nodes, setNodes] = useState<VFSNode[]>([]);
  const [searchMatches, setSearchMatches] =
    useState<ReadonlyMap<string, NodeSearchResult>>(EMPTY_SEARCH_MATCHES);
  const [loading, setLoading] = useState(true);
  const [repositorySetupState, setRepositorySetupState] =
    useState<RepositorySetupState>(() =>
      getInitialRepositorySetupState(repositoryStatus.config),
    );
  const [renamingNewId, setRenamingNewId] = useState<string | null>(null);
  const loadRequestRef = useRef(0);
  const isFiltering = filterTags && filterTags.length > 0;
  const isSearching = !!searchQuery?.trim();

  useEffect(() => {
    let cancelled = false;
    const config = repositoryStatus.config;

    if (config.kind === 'local') {
      setRepositorySetupState('ready');
      return;
    }

    if (!isRepositoryConfigStructurallyComplete(config)) {
      setRepositorySetupState('setup-required');
      return;
    }

    setRepositorySetupState('checking');
    void isRepositoryFullyConfigured(config).then((configured) => {
      if (!cancelled) {
        setRepositorySetupState(configured ? 'ready' : 'setup-required');
      }
    });

    return () => {
      cancelled = true;
    };
  }, [repositoryStatus.config]);

  const reload = useCallback(async () => {
    const requestId = loadRequestRef.current + 1;
    loadRequestRef.current = requestId;
    if (repositorySetupState !== 'ready') {
      setNodes([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      let nextNodes: VFSNode[];
      let nextMatches: ReadonlyMap<string, NodeSearchResult> =
        EMPTY_SEARCH_MATCHES;
      if (isSearching) {
        let results = await repository.searchNodes(searchQuery!.trim(), {
          mode: searchMode,
        });
        if (isFiltering) {
          results = results.filter((r) =>
            nodeMatchesAnyTag(r.node.tags, filterTags!),
          );
        }
        nextNodes = results.map((result) => result.node);
        nextMatches = new Map(
          results.map((result) => [result.node.id, result]),
        );
      } else if (isFiltering) {
        nextNodes = await repository.getNodesByAnyTag(filterTags);
      } else {
        const [dirs, files] = await repository.listDirectory(currentFolderId);
        nextNodes = [...dirs, ...files];
      }

      if (requestId === loadRequestRef.current) {
        setNodes(nextNodes);
        setSearchMatches(nextMatches);
      }
    } catch (err) {
      if (requestId === loadRequestRef.current) {
        logger.error('Failed to load explorer nodes', err, {
          currentFolderId,
          isFiltering,
          isSearching,
        });
      }
    } finally {
      if (requestId === loadRequestRef.current) {
        setLoading(false);
      }
    }
  }, [
    currentFolderId,
    filterTags,
    isFiltering,
    isSearching,
    repository,
    repositorySetupState,
    searchMode,
    searchQuery,
  ]);
  const reloadNow = useEffectEvent(() => {
    void reload();
  });

  const startNewFolder = useCallback(async () => {
    const name = await repository.getUniqueFileName(
      strings.library.createNew.unnamedFolder,
      currentFolderId,
    );
    const id = await repository.createFolder(name, currentFolderId);
    loadRequestRef.current++;
    setRenamingNewId(id);
    const now = Date.now();
    setNodes((prev) => [
      {
        id,
        name,
        type: 'folder' as const,
        parentId: currentFolderId,
        children: [],
        tags: [],
        createdAt: now,
        modifiedAt: now,
      },
      ...prev,
    ]);
    onChanged?.();
    requestAnimationFrame(() => setRenamingNewId(null));
  }, [
    currentFolderId,
    onChanged,
    repository,
    strings.library.createNew.unnamedFolder,
  ]);

  const startNewFile = useCallback(
    async (title: string, type: FileType) => {
      const name = await repository.getUniqueFileName(title, currentFolderId);
      const id = await repository.createFile(name, type, currentFolderId);
      loadRequestRef.current++;
      setRenamingNewId(id);
      const now = Date.now();
      setNodes((prev) => [
        ...prev,
        {
          id,
          name,
          type: 'file' as const,
          fileType: type,
          parentId: currentFolderId,
          tags: [],
          createdAt: now,
          modifiedAt: now,
        },
      ]);
      onChanged?.();
      requestAnimationFrame(() => setRenamingNewId(null));
    },
    [currentFolderId, onChanged, repository],
  );

  useImperativeHandle(ref, () => ({ reload, startNewFolder, startNewFile }), [
    reload,
    startNewFolder,
    startNewFile,
  ]);

  useEffect(() => {
    if (!isSearching || repositorySetupState !== 'ready') {
      void reload();
      return () => {
        loadRequestRef.current++;
      };
    }

    setLoading(true);
    const timer = window.setTimeout(() => {
      void reload();
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      loadRequestRef.current++;
    };
  }, [isSearching, reload, repositorySetupState]);

  useEffect(() => {
    if (repositoryStatus.lastRemoteSyncAt !== null) {
      reloadNow();
    }
  }, [repositoryStatus.lastRemoteSyncAt]);

  const reloadAndNotify = useCallback(async () => {
    await reload();
    onChanged?.();
  }, [reload, onChanged]);

  const sortedNodes = useMemo(() => {
    if (isSearching) {
      return nodes;
    }

    return [...nodes].sort((a, b) => {
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
    });
  }, [isSearching, nodes, sortMode]);

  const { dragOver, dropTargetProps } = useDropTarget({
    targetFolderId: currentFolderId,
    onMoved: reloadAndNotify,
  });

  // Container width drives the grid column count; reported by the list.
  const [containerWidth, setContainerWidth] = useState(0);

  const columns = Math.max(
    1,
    Math.floor((containerWidth + GRID_GAP) / (GRID_MIN_COLUMN + GRID_GAP)),
  );
  const cardWidth =
    containerWidth > 0
      ? (containerWidth - (columns - 1) * GRID_GAP) / columns
      : GRID_MIN_COLUMN;
  // 16:10 media + a rough body estimate; corrected once cards are measured.
  const estimateCardHeight = Math.round((cardWidth * 10) / 16) + 84;

  const getNodeKey = useCallback(
    (index: number) => sortedNodes[index]?.id ?? String(index),
    [sortedNodes],
  );

  const estimateTreeHeight = useCallback(
    (index: number) => (sortedNodes[index]?.type === 'folder' ? 44 : 36),
    [sortedNodes],
  );

  const pinnedIndex = useMemo(() => {
    if (!renamingNewId) {
      return -1;
    }
    return sortedNodes.findIndex((node) => node.id === renamingNewId);
  }, [sortedNodes, renamingNewId]);

  const canDrop =
    !isFiltering && !isSearching && repositorySetupState === 'ready';

  const renderNode = useCallback(
    (index: number) => {
      const node = sortedNodes[index];
      if (!node) {
        return null;
      }
      if (viewMode === 'grid') {
        return node.type === 'folder' ? (
          <GridFolderItem
            id={node.id}
            name={node.name}
            tags={node.tags}
            autoRename={node.id === renamingNewId}
            onNavigate={() => onNavigate(node.id)}
            onMoved={reloadAndNotify}
          />
        ) : (
          <GridFileItem
            file={node}
            searchMatch={searchMatches.get(node.id)}
            autoRename={node.id === renamingNewId}
            onChanged={reloadAndNotify}
          />
        );
      }
      return node.type === 'folder' ? (
        <FolderItem
          id={node.id}
          name={node.name}
          tags={node.tags}
          autoRename={node.id === renamingNewId}
          onNavigate={() => onNavigate(node.id)}
          onMoved={reloadAndNotify}
        />
      ) : (
        <FileItem
          file={node}
          searchMatch={searchMatches.get(node.id)}
          autoRename={node.id === renamingNewId}
          onChanged={reloadAndNotify}
        />
      );
    },
    [
      sortedNodes,
      viewMode,
      renamingNewId,
      onNavigate,
      reloadAndNotify,
      searchMatches,
    ],
  );

  if (loading || repositorySetupState === 'checking') {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-border-subtle border-t-text-secondary" />
      </div>
    );
  }

  if (sortedNodes.length === 0) {
    return (
      <div
        {...(canDrop ? dropTargetProps : {})}
        className={cn(
          'min-h-[80px] rounded-xl transition-colors',
          dragOver && canDrop ? 'bg-accent/10' : '',
        )}
      >
        <span className="block px-4 py-3 text-sm text-text-muted">
          {repositorySetupState === 'setup-required'
            ? strings.library.explorerTree.repositorySetupRequired
            : isSearching
              ? strings.library.explorerTree.emptySearch
              : isFiltering
                ? strings.library.explorerTree.emptyFilter
                : strings.library.explorerTree.emptyDefault}
        </span>
      </div>
    );
  }

  const containerClassName = cn(
    'min-h-[80px] rounded-xl transition-colors',
    dragOver && canDrop ? 'bg-accent/10' : '',
  );
  const containerProps = canDrop ? dropTargetProps : undefined;

  if (viewMode === 'grid') {
    return (
      <VirtualGrid
        scrollRef={scrollRef}
        itemCount={sortedNodes.length}
        columns={columns}
        cardWidth={cardWidth}
        columnGap={GRID_GAP}
        rowGap={GRID_GAP}
        estimateItemHeight={estimateCardHeight}
        getItemKey={getNodeKey}
        renderItem={renderNode}
        pinnedIndex={pinnedIndex}
        onWidthChange={setContainerWidth}
        className={containerClassName}
        containerProps={containerProps}
      />
    );
  }

  return (
    <VirtualList
      scrollRef={scrollRef}
      count={sortedNodes.length}
      estimateHeight={estimateTreeHeight}
      getRowKey={getNodeKey}
      gap={TREE_GAP}
      pinnedIndex={pinnedIndex}
      renderRow={renderNode}
      className={containerClassName}
      containerProps={containerProps}
    />
  );
}
