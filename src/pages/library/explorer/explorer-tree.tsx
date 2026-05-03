import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useMessages } from '@/lib/i18n';
import { Logger } from '@/lib/logger';
import {
  type FileType,
  isRepositoryConfigStructurallyComplete,
  isRepositoryFullyConfigured,
  useRepository,
  useRepositoryStatus,
  type VFSNode,
} from '@/lib/sync';
import { cn } from '@/lib/utils';
import { FileItem } from './file-item';
import { FolderItem } from './folder-item';
import { GridFileItem } from './grid-file-item';
import { GridFolderItem } from './grid-folder-item';
import { useDropTarget } from './use-drop-target';

const logger = new Logger('ExplorerTree');

type RepositorySetupState = 'checking' | 'ready' | 'setup-required';

function getInitialRepositorySetupState(
  config: ReturnType<typeof useRepositoryStatus>['config'],
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

interface ExplorerTreeProps {
  ref?: React.Ref<ExplorerTreeHandle>;
  currentFolderId: string | null;
  onNavigate: (folderId: string) => void;
  onChanged?: () => void;
  sortMode?: SortMode;
  viewMode?: ViewMode;
  searchQuery?: string;
  filterTags?: string[];
}

export function ExplorerTree({
  currentFolderId,
  onNavigate,
  ref,
  onChanged,
  sortMode = 'name-asc',
  viewMode = 'tree',
  searchQuery,
  filterTags,
}: ExplorerTreeProps) {
  const strings = useMessages();
  const repository = useRepository();
  const repositoryStatus = useRepositoryStatus();
  const [nodes, setNodes] = useState<VFSNode[]>([]);
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
      if (isSearching) {
        nextNodes = await repository.searchNodes(searchQuery!.trim());
        if (isFiltering) {
          const tagSet = new Set(filterTags);
          nextNodes = nextNodes.filter((n) =>
            n.tags.some((t) => tagSet.has(t)),
          );
        }
      } else if (isFiltering) {
        nextNodes = await repository.getNodesByAnyTag(filterTags);
      } else {
        const [dirs, files] = await repository.listDirectory(currentFolderId);
        nextNodes = [...dirs, ...files];
      }

      if (requestId === loadRequestRef.current) {
        setNodes(nextNodes);
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
    searchQuery,
  ]);

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
    reload();
  }, [reload]);

  useEffect(() => {
    if (repositoryStatus.lastRemoteSyncAt !== null) {
      reload();
    }
  }, [reload, repositoryStatus.lastRemoteSyncAt]);

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

  if (loading || repositorySetupState === 'checking') {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-border-subtle border-t-text-secondary" />
      </div>
    );
  }

  const containerClass =
    viewMode === 'grid'
      ? 'grid min-h-[80px] grid-cols-[repeat(auto-fill,minmax(198px,1fr))] gap-4 rounded-xl transition-colors'
      : 'flex min-h-[80px] flex-col gap-1 rounded-xl transition-colors';

  return (
    <div
      {...(isFiltering || isSearching || repositorySetupState !== 'ready'
        ? {}
        : dropTargetProps)}
      className={cn(
        containerClass,
        dragOver &&
          !isFiltering &&
          !isSearching &&
          repositorySetupState === 'ready'
          ? 'bg-accent/10'
          : '',
      )}
    >
      {sortedNodes.map((node) => {
        if (viewMode === 'grid') {
          return node.type === 'folder' ? (
            <GridFolderItem
              key={node.id}
              id={node.id}
              name={node.name}
              tags={node.tags}
              autoRename={node.id === renamingNewId}
              onNavigate={() => onNavigate(node.id)}
              onMoved={reloadAndNotify}
            />
          ) : (
            <GridFileItem
              key={node.id}
              file={node}
              autoRename={node.id === renamingNewId}
              onChanged={reloadAndNotify}
            />
          );
        }
        return node.type === 'folder' ? (
          <FolderItem
            key={node.id}
            id={node.id}
            name={node.name}
            tags={node.tags}
            autoRename={node.id === renamingNewId}
            onNavigate={() => onNavigate(node.id)}
            onMoved={reloadAndNotify}
          />
        ) : (
          <FileItem
            key={node.id}
            file={node}
            autoRename={node.id === renamingNewId}
            onChanged={reloadAndNotify}
          />
        );
      })}
      {nodes.length === 0 && (
        <span
          className={cn(
            'px-4 py-3 text-sm text-text-muted',
            viewMode === 'grid' ? 'col-span-full' : '',
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
      )}
    </div>
  );
}
