import {
  type Ref,
  useCallback,
  useEffect,
  useImperativeHandle,
  useState,
} from 'react';
import { ChevronRight, FileText, Folder } from 'lucide-react';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu';
import { VersionHistoryDialog } from '@/components/version-history-dialog';
import { IS_DEV } from '@/lib/env';
import { useMessages } from '@/lib/i18n';
import { Logger } from '@/lib/logger';
import { openNote } from '@/lib/note/navigation';
import {
  type FileType,
  useRepository,
  type VFSFileNode,
  type VFSFolderNode,
} from '@/lib/sync';
import { useTabController } from '@/lib/tabs/context';
import { cn } from '@/lib/utils';
import { formatExplorerItemAccessibleName } from '../accessibility-labels';
import { ItemContextMenu } from '../explorer/item-context-menu';
import { RenameReferencesDialog } from '../explorer/rename-references-dialog';
import { useDropTarget } from '../explorer/use-drop-target';
import { useExplorerItem } from '../explorer/use-explorer-item';
import { TagManageDialog } from '../tag-manage-dialog';
import type { RepositorySetupState } from '../use-repository-setup-state';

const logger = new Logger('FolderTree');
const ROOT_KEY = '__root__';

export interface FolderTreeHandle {
  /** Create a folder under the selected folder and start renaming it. */
  startNewFolder: () => Promise<void>;
  /** Create a file under the selected folder and start renaming it. */
  startNewFile: (title: string, type: FileType) => Promise<void>;
}

interface FolderTreeProps {
  ref?: Ref<FolderTreeHandle>;
  selectedFolderId: string | null;
  onSelect: (folderId: string | null, name: string) => void;
  /** Notify the parent so the file pane reloads after a move/rename/delete. */
  onChanged: () => void;
  setupState: RepositorySetupState;
  /** Bumped by the parent to refetch the tree after external changes. */
  refreshKey?: number;
}

function keyOf(folderId: string | null): string {
  return folderId ?? ROOT_KEY;
}

export function FolderTree({
  ref,
  selectedFolderId,
  onSelect,
  onChanged,
  setupState,
  refreshKey = 0,
}: FolderTreeProps) {
  const strings = useMessages();
  const repository = useRepository();
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set([ROOT_KEY]),
  );
  const [version, setVersion] = useState(0);
  const [renamingId, setRenamingId] = useState<string | null>(null);

  const bump = useCallback(() => setVersion((value) => value + 1), []);

  const toggle = useCallback((folderId: string | null) => {
    const key = keyOf(folderId);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const expand = useCallback((folderId: string | null) => {
    setExpanded((prev) => {
      const key = keyOf(folderId);
      if (prev.has(key)) {
        return prev;
      }
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  }, []);

  const handleChanged = useCallback(() => {
    bump();
    onChanged();
    // A new folder keeps its renaming flag until the user commits the rename
    // (which fires onChanged), at which point it is safe to clear.
    setRenamingId(null);
  }, [bump, onChanged]);

  const startNewFolder = useCallback(async () => {
    try {
      const name = await repository.getUniqueFileName(
        strings.library.createNew.unnamedFolder,
        selectedFolderId,
      );
      const id = await repository.createFolder(name, selectedFolderId);
      expand(selectedFolderId);
      setRenamingId(id);
      bump();
      onChanged();
    } catch (error) {
      logger.error('Failed to create folder', error, { selectedFolderId });
    }
  }, [
    repository,
    selectedFolderId,
    strings.library.createNew.unnamedFolder,
    expand,
    bump,
    onChanged,
  ]);

  const startNewFile = useCallback(
    async (title: string, type: FileType) => {
      try {
        const name = await repository.getUniqueFileName(
          title,
          selectedFolderId,
        );
        const id = await repository.createFile(name, type, selectedFolderId);
        expand(selectedFolderId);
        setRenamingId(id);
        bump();
        onChanged();
      } catch (error) {
        logger.error('Failed to create file', error, { selectedFolderId });
      }
    },
    [repository, selectedFolderId, expand, bump, onChanged],
  );

  useImperativeHandle(ref, () => ({ startNewFolder, startNewFile }), [
    startNewFolder,
    startNewFile,
  ]);

  return (
    <div className="flex h-full flex-col">
      <div className="px-4 pt-4 pb-2 font-bold text-[10px] text-text-muted uppercase tracking-[1px]">
        {strings.library.explorer}
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-4">
        <FolderNode
          folderId={null}
          name={strings.library.allFiles}
          tags={[]}
          depth={0}
          selectedFolderId={selectedFolderId}
          onSelect={onSelect}
          expanded={expanded}
          onToggle={toggle}
          onExpand={expand}
          version={version + refreshKey}
          renamingId={renamingId}
          onChanged={handleChanged}
          setupState={setupState}
        />
      </div>
    </div>
  );
}

interface FolderNodeProps {
  folderId: string | null;
  name: string;
  tags: string[];
  depth: number;
  selectedFolderId: string | null;
  onSelect: (folderId: string | null, name: string) => void;
  expanded: Set<string>;
  onToggle: (folderId: string | null) => void;
  onExpand: (folderId: string | null) => void;
  version: number;
  renamingId: string | null;
  onChanged: () => void;
  setupState: RepositorySetupState;
}

function FolderNode({
  folderId,
  name,
  tags,
  depth,
  selectedFolderId,
  onSelect,
  expanded,
  onToggle,
  onExpand,
  version,
  renamingId,
  onChanged,
  setupState,
}: FolderNodeProps) {
  const repository = useRepository();
  const isRoot = folderId === null;
  const isExpanded = expanded.has(keyOf(folderId));
  const isSelected = selectedFolderId === folderId;
  const [childFolders, setChildFolders] = useState<VFSFolderNode[] | null>(
    null,
  );
  const [childFiles, setChildFiles] = useState<VFSFileNode[] | null>(null);
  const [tagDialogOpen, setTagDialogOpen] = useState(false);

  const {
    renaming,
    dragging,
    startRenaming,
    handleRemove,
    handleDragStart,
    handleDragEnd,
    renameInputProps,
  } = useExplorerItem({
    nodeId: folderId ?? ROOT_KEY,
    name,
    dragKind: 'folder',
    onChanged,
    initialRenaming: !isRoot && folderId === renamingId,
  });

  const { dragOver, dropTargetProps } = useDropTarget({
    targetFolderId: folderId,
    onMoved: onChanged,
  });

  // Load subfolders lazily once expanded; refetch when the tree version bumps.
  // biome-ignore lint/correctness/useExhaustiveDependencies: version is a refetch trigger, not read in the body
  useEffect(() => {
    if (!isExpanded || setupState !== 'ready') {
      return;
    }
    let cancelled = false;
    repository
      .listDirectory(folderId)
      .then(([dirs, files]) => {
        if (!cancelled) {
          setChildFolders(
            [...dirs].sort((a, b) => a.name.localeCompare(b.name)),
          );
          setChildFiles(
            [...files].sort((a, b) => a.name.localeCompare(b.name)),
          );
        }
      })
      .catch((error) => {
        if (!cancelled) {
          logger.error('Failed to load tree children', error, { folderId });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isExpanded, version, folderId, repository, setupState]);

  const selectThis = () => {
    if (renaming) {
      return;
    }
    onSelect(folderId, name);
    onExpand(folderId);
  };

  const indentStyle = { paddingLeft: `${depth * 14 + 4}px` };

  const row = (
    <div
      className={cn(
        'group flex w-full items-center gap-1 rounded-lg py-1.5 pr-2 transition-colors duration-150',
        isSelected ? 'bg-accent/15' : 'hover:bg-hover-tint',
        dragOver && 'bg-accent/15 ring-1 ring-accent/40',
        dragging && 'opacity-40',
      )}
      style={indentStyle}
      {...dropTargetProps}
    >
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onToggle(folderId);
        }}
        aria-label={name}
        aria-expanded={isExpanded}
        className="flex size-4 shrink-0 items-center justify-center rounded text-text-muted transition-colors hover:text-text-secondary"
      >
        <ChevronRight
          className={cn(
            'size-3 transition-transform duration-150',
            isExpanded && 'rotate-90',
          )}
        />
      </button>
      <button
        type="button"
        draggable={!isRoot && !renaming}
        onClick={selectThis}
        onDragStart={isRoot ? undefined : handleDragStart}
        onDragEnd={isRoot ? undefined : handleDragEnd}
        aria-label={
          renaming ? undefined : formatExplorerItemAccessibleName(name, tags)
        }
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
      >
        <Folder
          className={cn(
            'size-3.5 shrink-0 transition-colors',
            isSelected
              ? 'fill-accent-amber-strong text-accent-amber-strong'
              : 'fill-accent-amber text-accent-amber group-hover:fill-accent-amber-strong group-hover:text-accent-amber-strong',
          )}
        />
        {renaming ? (
          <input
            {...renameInputProps}
            className="min-w-0 flex-1 border-primary border-b bg-transparent text-sm text-text-primary outline-none"
          />
        ) : (
          <span
            className={cn(
              'truncate text-sm',
              isSelected
                ? 'font-medium text-text-primary'
                : 'text-text-secondary',
            )}
          >
            {name}
          </span>
        )}
      </button>
    </div>
  );

  return (
    <div>
      {folderId === null ? (
        row
      ) : (
        <>
          <ContextMenu>
            <ContextMenuTrigger render={row} />
            <ItemContextMenu
              onRename={startRenaming}
              onRemove={handleRemove}
              onManageTags={() => setTagDialogOpen(true)}
            />
          </ContextMenu>
          <TagManageDialog
            open={tagDialogOpen}
            onOpenChange={setTagDialogOpen}
            nodeId={folderId}
            nodeName={name}
            onChanged={onChanged}
          />
        </>
      )}

      {isExpanded && (
        <>
          {childFolders?.map((child) => (
            <FolderNode
              key={child.id}
              folderId={child.id}
              name={child.name}
              tags={child.tags}
              depth={depth + 1}
              selectedFolderId={selectedFolderId}
              onSelect={onSelect}
              expanded={expanded}
              onToggle={onToggle}
              onExpand={onExpand}
              version={version}
              renamingId={renamingId}
              onChanged={onChanged}
              setupState={setupState}
            />
          ))}
          {childFiles?.map((file) => (
            <FileNode
              key={file.id}
              file={file}
              depth={depth + 1}
              autoRename={file.id === renamingId}
              onChanged={onChanged}
            />
          ))}
        </>
      )}
    </div>
  );
}

interface FileNodeProps {
  file: VFSFileNode;
  depth: number;
  autoRename?: boolean;
  onChanged: () => void;
}

export function FileNode({
  file,
  depth,
  autoRename,
  onChanged,
}: FileNodeProps) {
  const repository = useRepository();
  const tabController = useTabController();
  const [tagDialogOpen, setTagDialogOpen] = useState(false);
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);

  const {
    renaming,
    dragging,
    startRenaming,
    handleRemove,
    handleDragStart,
    handleDragEnd,
    renameInputProps,
    renameReferencesPrompt,
    chooseRenameReferences,
  } = useExplorerItem({
    nodeId: file.id,
    name: file.name,
    dragKind: 'file',
    onChanged,
    initialRenaming: autoRename,
    renameReferencesOnRename: file.fileType === 'mcanvas',
  });

  // A leaf has no chevron, so it pads by the folder rows' base (depth*14 + 4)
  // plus the chevron width (16) and its gap (4) to align icons with siblings.
  const indentStyle = { paddingLeft: `${depth * 14 + 24}px` };

  const row = (
    <button
      type="button"
      draggable={!renaming}
      onClick={() => {
        if (!renaming) {
          openNote(tabController, file, file.name, 'explorer');
        }
      }}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      aria-label={
        renaming
          ? undefined
          : formatExplorerItemAccessibleName(file.name, file.tags)
      }
      style={indentStyle}
      className={cn(
        'group flex w-full cursor-pointer items-center gap-2 rounded-lg py-1.5 pr-2 text-left transition-colors duration-150 hover:bg-hover-tint',
        dragging && 'opacity-40',
      )}
    >
      <FileText className="size-3.5 shrink-0 text-text-muted transition-colors group-hover:text-text-secondary" />
      {renaming ? (
        <input
          {...renameInputProps}
          className="min-w-0 flex-1 border-primary border-b bg-transparent text-sm text-text-secondary outline-none"
        />
      ) : (
        <span className="truncate text-sm text-text-secondary transition-colors group-hover:text-text-primary">
          {file.name}
        </span>
      )}
    </button>
  );

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger render={row} />
        <ItemContextMenu
          onRename={startRenaming}
          onRemove={handleRemove}
          onManageTags={() => setTagDialogOpen(true)}
          onVersionHistory={() => setVersionHistoryOpen(true)}
          onReveal={
            IS_DEV
              ? async () => {
                  const path = await repository.getRevealPath(file.id);
                  if (path) {
                    await revealItemInDir(path);
                  }
                }
              : undefined
          }
        />
      </ContextMenu>
      <TagManageDialog
        open={tagDialogOpen}
        onOpenChange={setTagDialogOpen}
        nodeId={file.id}
        nodeName={file.name}
        onChanged={onChanged}
      />
      <VersionHistoryDialog
        open={versionHistoryOpen}
        onOpenChange={setVersionHistoryOpen}
        fileId={file.id}
        fileName={file.name}
        fileType={file.fileType}
        onRestored={onChanged}
      />
      <RenameReferencesDialog
        prompt={renameReferencesPrompt}
        onChoice={chooseRenameReferences}
      />
    </>
  );
}
