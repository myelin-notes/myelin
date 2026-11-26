import {
  type RefObject,
  useCallback,
  useEffect,
  useEffectEvent,
  useImperativeHandle,
  useMemo,
  useState,
} from 'react';
import { Import, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { VirtualList } from '@myelin/editor/components/virtual-list';
import { useLocale, useMessages } from '@myelin/editor/i18n';
import { cn } from '@myelin/editor/utils';
import { Logger } from '@myelin/shared/logger';
import { Button } from '@myelin/ui/button';
import { VirtualGrid } from '@/components/virtual-grid';
import { createCanvasFromTemplate } from '@/lib/note/templates';
import { useTemplates } from '@/lib/note/use-templates';
import {
  type FileType,
  type NodeSearchResult,
  useRepository,
  useRepositoryStatus,
  type VFSNode,
  type VFSNodeId,
} from '@/lib/sync';
import { isTemplatesRoot } from '@/lib/sync/repo/shared';
import { useNoteIndexStatus } from '@/lib/sync/repo/use-note-index-status';
import { pickAndImportTemplates } from '../import/template';
import {
  ExplorerModel,
  type ExplorerSortMode,
  sortExplorerNodes,
} from './explorer-model';
import { FileItem } from './file-item';
import { FolderItem } from './folder-item';
import { GridFileItem } from './grid/file-item';
import { GridFolderItem } from './grid/folder-item';
import { TemplatesPlaceholderItem } from './templates-folder';
import { useDropTarget } from './use-drop-target';
import { useExplorerSetupState } from './use-explorer-setup-state';

const logger = new Logger('ExplorerTree');
const SEARCH_DEBOUNCE_MS = 150;
const EMPTY_SEARCH_MATCHES: ReadonlyMap<string, NodeSearchResult> = new Map();

// Grid layout matches `repeat(auto-fill, minmax(198px, 1fr))` with a 16px gap.
const GRID_MIN_COLUMN = 198;
const GRID_GAP = 16;
const TREE_GAP = 4;
const TEMPLATES_PLACEHOLDER = 'templates-placeholder';

export interface ExplorerTreeHandle {
  reload: () => Promise<void>;
  startNewFolder: () => Promise<void>;
  startNewFile: (
    title: string,
    type: FileType,
    templateId?: VFSNodeId | null,
  ) => Promise<void>;
  importTemplates: () => Promise<void>;
}

export type SortMode = ExplorerSortMode;
export type ViewMode = 'tree' | 'grid';

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
  filterTags,
  onCreateCanvas,
}: ExplorerTreeProps) {
  const strings = useMessages();
  const locale = useLocale();
  const { rootId: templatesRootId } = useTemplates();
  const repository = useRepository();
  const repositoryStatus = useRepositoryStatus();
  const noteIndexStatus = useNoteIndexStatus();
  const explorer = useMemo(
    () =>
      new ExplorerModel(repository, (name, parentId, templateId) =>
        createCanvasFromTemplate(repository, name, parentId, templateId),
      ),
    [repository],
  );
  const [nodes, setNodes] = useState<VFSNode[]>([]);
  const [searchMatches, setSearchMatches] =
    useState<ReadonlyMap<string, NodeSearchResult>>(EMPTY_SEARCH_MATCHES);
  const [loading, setLoading] = useState(true);
  const repositorySetupState = useExplorerSetupState(repositoryStatus.config);
  const [renamingNewId, setRenamingNewId] = useState<string | null>(null);
  const [renamePrefill, setRenamePrefill] = useState<string | undefined>();
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
    searchQuery,
  ]);
  const reloadNow = useEffectEvent(() => {
    void reload();
  });

  const finishNewRename = useCallback((nodeId: string) => {
    setRenamingNewId((current) => (current === nodeId ? null : current));
  }, []);

  const startNewFolder = useCallback(async () => {
    const node = await explorer.createFolder(
      currentFolderId,
      strings.library.createNew.unnamedFolder,
    );
    setRenamingNewId(node.id);
    setRenamePrefill(undefined);
    setNodes((prev) => [node, ...prev.filter((item) => item.id !== node.id)]);
    setLoading(false);
    onChanged?.();
  }, [
    currentFolderId,
    explorer,
    onChanged,
    strings.library.createNew.unnamedFolder,
  ]);

  const startNewFile = useCallback(
    async (title: string, type: FileType, templateId?: VFSNodeId | null) => {
      const { node, renameValue } = await explorer.createFile(
        currentFolderId,
        title,
        type,
        { templateId, locale },
      );
      setRenamingNewId(node.id);
      setRenamePrefill(renameValue ?? undefined);
      setNodes((prev) => [...prev.filter((item) => item.id !== node.id), node]);
      setLoading(false);
      onChanged?.();
    },
    [currentFolderId, explorer, locale, onChanged],
  );

  const openTemplates = useCallback(() => {
    repository
      .ensureTemplatesRoot()
      .then(onNavigate)
      .catch((error) => {
        logger.error('Failed to create templates folder', error);
      });
  }, [onNavigate, repository]);

  const newTemplate = useCallback(() => {
    const title = strings.library.createNew.untitledCanvas;
    void (async () => {
      const rootId = await repository.ensureTemplatesRoot();
      if (rootId === currentFolderId) {
        await startNewFile(title, 'mcanvas', null);
        return;
      }
      const { node, renameValue } = await explorer.createFile(
        rootId,
        title,
        'mcanvas',
        { templateId: null, locale },
      );
      setRenamingNewId(node.id);
      setRenamePrefill(renameValue ?? undefined);
      onNavigate(rootId);
      onChanged?.();
    })().catch((error) => {
      logger.error('Failed to create template', error);
      toast.error(strings.commandPalette.errors.createNote);
    });
  }, [
    currentFolderId,
    explorer,
    locale,
    onChanged,
    onNavigate,
    repository,
    startNewFile,
    strings,
  ]);

  const importTemplates = useCallback(async () => {
    try {
      const rootId = await pickAndImportTemplates(repository);
      if (rootId === null) {
        return;
      }
      if (rootId === currentFolderId) {
        await reload();
      } else {
        onNavigate(rootId);
      }
      onChanged?.();
    } catch (error) {
      logger.error('Failed to import template', error);
      toast.error(strings.library.templates.importFailed);
    }
  }, [currentFolderId, onChanged, onNavigate, reload, repository, strings]);

  const templateActions = useMemo(
    () => ({
      onNewTemplate: newTemplate,
      onImportTemplate: () => void importTemplates(),
    }),
    [importTemplates, newTemplate],
  );

  useImperativeHandle(
    ref,
    () => ({ reload, startNewFolder, startNewFile, importTemplates }),
    [reload, startNewFolder, startNewFile, importTemplates],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: index revision refreshes active search results
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
  }, [
    explorer,
    isSearching,
    reload,
    repositorySetupState,
    noteIndexStatus.revision,
  ]);

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

  const showTemplatesPlaceholder =
    currentFolderId === null &&
    !isSearching &&
    !isFiltering &&
    repositorySetupState === 'ready' &&
    sortedNodes.length > 0 &&
    !sortedNodes.some(isTemplatesRoot);
  const items = useMemo<(VFSNode | typeof TEMPLATES_PLACEHOLDER)[]>(
    () =>
      showTemplatesPlaceholder
        ? [TEMPLATES_PLACEHOLDER, ...sortedNodes]
        : sortedNodes,
    [showTemplatesPlaceholder, sortedNodes],
  );

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
    (index: number) => {
      const item = items[index];
      return typeof item === 'string' ? item : (item?.id ?? String(index));
    },
    [items],
  );

  const estimateTreeHeight = useCallback(
    (index: number) => {
      const item = items[index];
      return typeof item === 'string' || item?.type === 'folder' ? 44 : 36;
    },
    [items],
  );

  const pinnedIndex = useMemo(() => {
    if (!renamingNewId) {
      return -1;
    }
    return items.findIndex(
      (item) => typeof item !== 'string' && item.id === renamingNewId,
    );
  }, [items, renamingNewId]);

  const canDrop =
    !isFiltering && !isSearching && repositorySetupState === 'ready';

  const renderNode = useCallback(
    (index: number) => {
      const node = items[index];
      if (!node) {
        return null;
      }
      if (node === TEMPLATES_PLACEHOLDER) {
        return (
          <TemplatesPlaceholderItem
            grid={viewMode === 'grid'}
            onOpen={openTemplates}
            {...templateActions}
          />
        );
      }
      if (viewMode === 'grid') {
        return node.type === 'folder' ? (
          <GridFolderItem
            folder={node}
            autoRename={node.id === renamingNewId}
            onRenameEnd={finishNewRename}
            onNavigate={() => onNavigate(node.id)}
            onMoved={reloadAndNotify}
            templateActions={templateActions}
          />
        ) : (
          <GridFileItem
            file={node}
            searchMatch={searchMatches.get(node.id)}
            autoRename={node.id === renamingNewId}
            renamePrefill={renamePrefill}
            isTemplate={
              templatesRootId !== null && node.parentId === templatesRootId
            }
            onRenameEnd={finishNewRename}
            onChanged={reloadAndNotify}
          />
        );
      }
      return node.type === 'folder' ? (
        <FolderItem
          folder={node}
          autoRename={node.id === renamingNewId}
          onRenameEnd={finishNewRename}
          onNavigate={() => onNavigate(node.id)}
          onMoved={reloadAndNotify}
          templateActions={templateActions}
        />
      ) : (
        <FileItem
          file={node}
          searchMatch={searchMatches.get(node.id)}
          autoRename={node.id === renamingNewId}
          renamePrefill={renamePrefill}
          isTemplate={
            templatesRootId !== null && node.parentId === templatesRootId
          }
          onRenameEnd={finishNewRename}
          onChanged={reloadAndNotify}
        />
      );
    },
    [
      items,
      openTemplates,
      templateActions,
      viewMode,
      renamingNewId,
      finishNewRename,
      onNavigate,
      reloadAndNotify,
      renamePrefill,
      searchMatches,
      templatesRootId,
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
    const browsing =
      repositorySetupState === 'ready' && !isSearching && !isFiltering;
    const inTemplates =
      browsing &&
      currentFolderId !== null &&
      currentFolderId === templatesRootId;
    const showCreateCanvas =
      browsing && !inTemplates && onCreateCanvas !== undefined;

    return (
      <div
        {...(canDrop ? dropTargetProps : {})}
        className={cn(
          'min-h-[80px] rounded-xl transition-colors',
          (showCreateCanvas || inTemplates) &&
            'flex min-h-40 flex-col items-center justify-center gap-4 px-4 py-8 text-center',
          dragOver && canDrop ? 'bg-accent/10' : '',
        )}
      >
        <span
          className={cn(
            'block text-sm text-text-muted',
            !showCreateCanvas && !inTemplates && 'px-4 py-3',
          )}
        >
          {repositorySetupState === 'setup-required'
            ? strings.library.explorerTree.repositorySetupRequired
            : isSearching
              ? strings.library.explorerTree.emptySearch
              : isFiltering
                ? strings.library.explorerTree.emptyFilter
                : inTemplates
                  ? strings.library.templates.emptyFolder
                  : strings.library.explorerTree.emptyDefault}
        </span>
        {inTemplates && (
          <div className="flex flex-wrap justify-center gap-2">
            <Button size="lg" onClick={templateActions.onNewTemplate}>
              <Plus />
              {strings.library.templates.newTemplate}
            </Button>
            <Button
              size="lg"
              variant="outline"
              onClick={templateActions.onImportTemplate}
            >
              <Import />
              {strings.library.templates.importTemplate}
            </Button>
          </div>
        )}
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
    // While a row is renaming, other rows ignore clicks; the click lands on the
    // container instead and blurs the input, which commits the rename.
    '[&:has(input)_button:not(:has(input))]:pointer-events-none',
    dragOver && canDrop ? 'bg-accent/10' : '',
  );
  const containerProps = canDrop ? dropTargetProps : undefined;

  if (viewMode === 'grid') {
    return (
      <VirtualGrid
        scrollRef={scrollRef}
        itemCount={items.length}
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
      count={items.length}
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
