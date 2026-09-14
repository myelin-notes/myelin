import {
  type RefObject,
  useCallback,
  useEffect,
  useEffectEvent,
  useImperativeHandle,
  useMemo,
  useState,
} from 'react';
import { Plus } from 'lucide-react';
import { VirtualList } from '@myelin/editor/components/virtual-list';
import { useMessages } from '@myelin/editor/i18n';
import { cn } from '@myelin/editor/utils';
import { Logger } from '@myelin/shared/logger';
import { Button } from '@myelin/ui/button';
import { VirtualGrid } from '@/components/virtual-grid';
import { createBlankCanvasFile } from '@/lib/note/create';
import {
  type FileType,
  type NodeSearchResult,
  useRepository,
  useRepositoryStatus,
  type VFSNode,
} from '@/lib/sync';
import {
  ExplorerModel,
  type ExplorerSearchMode,
  type ExplorerSortMode,
  sortExplorerNodes,
} from './explorer-model';
import { FileItem } from './file-item';
import { FolderItem } from './folder-item';
import { GridFileItem } from './grid/file-item';
import { GridFolderItem } from './grid/folder-item';
import { useDropTarget } from './use-drop-target';
import { useExplorerSetupState } from './use-explorer-setup-state';

const logger = new Logger('ExplorerTree');
const SEARCH_DEBOUNCE_MS = 150;
const EMPTY_SEARCH_MATCHES: ReadonlyMap<string, NodeSearchResult> = new Map();

// Grid layout matches `repeat(auto-fill, minmax(198px, 1fr))` with a 16px gap.
const GRID_MIN_COLUMN = 198;
const GRID_GAP = 16;
const TREE_GAP = 4;

export interface ExplorerTreeHandle {
  reload: () => Promise<void>;
  startNewFolder: () => Promise<void>;
  startNewFile: (title: string, type: FileType) => Promise<void>;
}

export type SortMode = ExplorerSortMode;
export type ViewMode = 'tree' | 'grid';
export type SearchMode = ExplorerSearchMode;

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
  onCreateCanvas?: () => void;
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
  onCreateCanvas,
}: ExplorerTreeProps) {
  const strings = useMessages();
  const repository = useRepository();
  const repositoryStatus = useRepositoryStatus();
  const explorer = useMemo(
    () =>
      new ExplorerModel(repository, (name, parentId) =>
        createBlankCanvasFile(repository, name, parentId),
      ),
    [repository],
  );
  const [nodes, setNodes] = useState<VFSNode[]>([]);
  const [searchMatches, setSearchMatches] =
    useState<ReadonlyMap<string, NodeSearchResult>>(EMPTY_SEARCH_MATCHES);
  const [loading, setLoading] = useState(true);
  const repositorySetupState = useExplorerSetupState(repositoryStatus.config);
  const [renamingNewId, setRenamingNewId] = useState<string | null>(null);
  const isFiltering = filterTags && filterTags.length > 0;
  const isSearching = !!searchQuery?.trim();

  const reload = useCallback(async () => {
    if (repositorySetupState !== 'ready') {
      setNodes([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const result = await explorer.refresh({
        folderId: currentFolderId,
        searchQuery: searchQuery ?? '',
        searchMode,
        filterTags: filterTags ?? [],
      });
      if (!result) {
        return;
      }
      setNodes(result.nodes);
      setSearchMatches(result.searchMatches);
      setLoading(false);
    } catch (err) {
      logger.error('Failed to load explorer nodes', err, {
        currentFolderId,
        isFiltering,
        isSearching,
      });
      setLoading(false);
    }
  }, [
    currentFolderId,
    explorer,
    filterTags,
    isFiltering,
    isSearching,
    repositorySetupState,
    searchMode,
    searchQuery,
  ]);
  const reloadNow = useEffectEvent(() => {
    void reload();
  });

  const startNewFolder = useCallback(async () => {
    const node = await explorer.createFolder(
      currentFolderId,
      strings.library.createNew.unnamedFolder,
    );
    setRenamingNewId(node.id);
    setNodes((prev) => [node, ...prev]);
    onChanged?.();
    requestAnimationFrame(() => setRenamingNewId(null));
  }, [
    currentFolderId,
    explorer,
    onChanged,
    strings.library.createNew.unnamedFolder,
  ]);

  const startNewFile = useCallback(
    async (title: string, type: FileType) => {
      const node = await explorer.createFile(currentFolderId, title, type);
      setRenamingNewId(node.id);
      setNodes((prev) => [...prev, node]);
      onChanged?.();
      requestAnimationFrame(() => setRenamingNewId(null));
    },
    [currentFolderId, explorer, onChanged],
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
        explorer.invalidatePendingRequests();
      };
    }

    setLoading(true);
    const timer = window.setTimeout(() => {
      void reload();
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      explorer.invalidatePendingRequests();
    };
  }, [explorer, isSearching, reload, repositorySetupState]);

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

    return sortExplorerNodes(nodes, sortMode);
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
            folder={node}
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
          folder={node}
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
    const showCreateCanvas =
      repositorySetupState === 'ready' &&
      !isSearching &&
      !isFiltering &&
      onCreateCanvas !== undefined;

    return (
      <div
        {...(canDrop ? dropTargetProps : {})}
        className={cn(
          'min-h-[80px] rounded-xl transition-colors',
          showCreateCanvas &&
            'flex min-h-40 flex-col items-center justify-center gap-4 px-4 py-8 text-center',
          dragOver && canDrop ? 'bg-accent/10' : '',
        )}
      >
        <span
          className={cn(
            'block text-sm text-text-muted',
            !showCreateCanvas && 'px-4 py-3',
          )}
        >
          {repositorySetupState === 'setup-required'
            ? strings.library.explorerTree.repositorySetupRequired
            : isSearching
              ? strings.library.explorerTree.emptySearch
              : isFiltering
                ? strings.library.explorerTree.emptyFilter
                : strings.library.explorerTree.emptyDefault}
        </span>
        {showCreateCanvas && (
          <Button size="lg" onClick={onCreateCanvas}>
            <Plus />
            {strings.library.createNew.canvas}
          </Button>
        )}
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
