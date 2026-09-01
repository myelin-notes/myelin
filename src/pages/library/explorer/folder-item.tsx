import { Folder } from 'lucide-react';
import { ContextMenu, ContextMenuTrigger } from '@myelin/ui/context-menu';
import type { VFSFolderNode } from '@/lib/sync';
import { formatExplorerItemAccessibleName } from '../accessibility-labels';
import { folderIconStyle } from './folder-colors';
import { TagList } from './tag-list';
import { useDropTarget } from './use-drop-target';
import { useFolderItemContextMenu } from './use-folder-item-context-menu';

interface FolderItemProps {
  folder: VFSFolderNode;
  autoRename?: boolean;
  onNavigate: () => void;
  onMoved: () => void;
}

export function FolderItem({
  folder,
  autoRename,
  onNavigate,
  onMoved,
}: FolderItemProps) {
  const {
    contextMenuProps,
    renaming,
    dragging,
    handleDragStart,
    handleDragEnd,
    renameInputProps,
    menu,
    dialogs,
  } = useFolderItemContextMenu(folder, onMoved, {
    initialRenaming: autoRename,
  });

  const { dragOver, dropTargetProps } = useDropTarget({
    targetFolderId: folder.id,
    onMoved,
  });

  return (
    <>
      <ContextMenu {...contextMenuProps}>
        <ContextMenuTrigger
          render={
            <button
              draggable={!renaming}
              onClick={() => {
                if (!renaming) {
                  onNavigate();
                }
              }}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              {...dropTargetProps}
              aria-label={
                renaming
                  ? undefined
                  : formatExplorerItemAccessibleName(folder.name, folder.tags)
              }
              className={`group flex w-full cursor-pointer items-center gap-3 rounded-lg px-4 py-3 transition-all duration-200 ${
                dragOver
                  ? 'bg-accent/15 ring-1 ring-accent/40'
                  : 'hover:bg-hover-tint'
              } ${dragging ? 'opacity-40' : ''}`}
            />
          }
        >
          <Folder
            className="size-4 shrink-0"
            style={folderIconStyle(folder.color)}
          />
          {renaming ? (
            <input
              {...renameInputProps}
              className="min-w-0 flex-1 border-primary border-b-2 bg-transparent font-medium text-sm text-text-primary outline-none"
            />
          ) : (
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate font-medium text-sm text-text-primary">
                {folder.name}
              </span>
              <TagList
                tags={folder.tags}
                className="flex shrink-0 items-center gap-1"
                tagClassName="rounded-md bg-tag/60 px-1.5 py-0.5 font-medium text-[9px] text-text-tag"
                overflowClassName="text-[9px] text-text-muted"
              />
            </div>
          )}
        </ContextMenuTrigger>
        {menu}
      </ContextMenu>
      {dialogs}
    </>
  );
}
