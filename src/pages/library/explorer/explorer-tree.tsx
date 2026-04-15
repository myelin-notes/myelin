import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from 'react';
import { type FileType, useRepository, type VFSNode } from '@/lib/sync';
import { FileItem } from './file-item';
import { FolderItem } from './folder-item';
import { useDropTarget } from './use-drop-target';

export interface ExplorerTreeHandle {
  reload: () => Promise<void>;
  startNewFolder: () => Promise<void>;
  startNewFile: (title: string, type: FileType) => Promise<void>;
}

export type SortMode = 'name-asc' | 'name-desc' | 'modified' | 'created';

interface ExplorerTreeProps {
  ref?: React.Ref<ExplorerTreeHandle>;
  currentFolderId: string | null;
  onNavigate: (folderId: string) => void;
  onTagsChanged?: () => void;
  sortMode?: SortMode;
  searchQuery?: string;
  filterTags?: string[];
}

export function ExplorerTree({
  currentFolderId,
  onNavigate,
  ref,
  onTagsChanged,
  sortMode = 'name-asc',
  searchQuery,
  filterTags,
}: ExplorerTreeProps) {
  const repository = useRepository();
  const [nodes, setNodes] = useState<VFSNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [renamingNewId, setRenamingNewId] = useState<string | null>(null);
  const isFiltering = filterTags && filterTags.length > 0;
  const isSearching = !!searchQuery?.trim();

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      if (isSearching) {
        let results = await repository.searchNodes(searchQuery!.trim());
        if (isFiltering) {
          const tagSet = new Set(filterTags);
          results = results.filter((n) => n.tags.some((t) => tagSet.has(t)));
        }
        setNodes(results);
      } else if (isFiltering) {
        setNodes(await repository.getNodesByAnyTag(filterTags));
      } else {
        const [dirs, files] = await repository.listDirectory(currentFolderId);
        setNodes([...dirs, ...files]);
      }
    } catch (err) {
      console.error('Failed to load directory:', err);
    }
    setLoading(false);
  }, [currentFolderId, isFiltering, filterTags, isSearching, searchQuery]);

  const startNewFolder = useCallback(async () => {
    const name = await repository.getUniqueFileName(
      'Unnamed Folder',
      currentFolderId,
    );
    const id = await repository.createFolder(name, currentFolderId);
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
    requestAnimationFrame(() => setRenamingNewId(null));
  }, [currentFolderId]);

  const startNewFile = useCallback(
    async (title: string, type: FileType) => {
      const name = await repository.getUniqueFileName(title, currentFolderId);
      const id = await repository.createFile(name, type, currentFolderId);
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
      requestAnimationFrame(() => setRenamingNewId(null));
    },
    [currentFolderId],
  );

  useImperativeHandle(ref, () => ({ reload, startNewFolder, startNewFile }), [
    reload,
    startNewFolder,
    startNewFile,
  ]);

  useEffect(() => {
    reload();
  }, [reload]);

  const reloadAndNotify = useCallback(async () => {
    await reload();
    onTagsChanged?.();
  }, [reload, onTagsChanged]);

  const sortedNodes = useMemo(() => {
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
  }, [nodes, sortMode]);

  const { dragOver, dropTargetProps } = useDropTarget({
    targetFolderId: currentFolderId,
    onMoved: reloadAndNotify,
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-border-subtle border-t-text-secondary" />
      </div>
    );
  }

  return (
    <div
      {...(isFiltering || isSearching ? {} : dropTargetProps)}
      className={`flex min-h-[80px] flex-col gap-1 rounded-xl transition-colors ${
        dragOver && !isFiltering && !isSearching ? 'bg-accent/10' : ''
      }`}
    >
      {sortedNodes.map((node) =>
        node.type === 'folder' ? (
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
        ),
      )}
      {nodes.length === 0 && (
        <span className="px-4 py-3 text-sm text-text-muted">
          {isSearching
            ? 'No results found'
            : isFiltering
              ? 'No items match the selected tags'
              : 'No files yet'}
        </span>
      )}
    </div>
  );
}
