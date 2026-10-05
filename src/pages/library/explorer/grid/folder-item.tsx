import { Folder } from 'lucide-react';
import { cn } from '@myelin/editor/utils';
import { ContextMenu, ContextMenuTrigger } from '@myelin/ui/context-menu';
import type { VFSFolderNode } from '@/lib/sync';
import { formatExplorerItemAccessibleName } from '../../accessibility-labels';
import { folderIconStyle } from '../folder-colors';
import { TagList } from '../tag-list';
import { useDropTarget } from '../use-drop-target';
import { useFolderItemContextMenu } from '../use-folder-item-context-menu';
import {
  explorerGridBodyClass,
  explorerGridCardClass,
  explorerGridCardDragOverClass,
  explorerGridFadeMask,
  explorerGridMediaClass,
  explorerGridPlaceholderStyle,
  explorerGridRenameInputClass,
  explorerGridTagClass,
  explorerGridTagOverflowClass,
  explorerGridTagsClass,
  explorerGridTitleClass,
} from './item-styles';

interface Props {
  folder: VFSFolderNode;
  autoRename?: boolean;
  onNavigate: () => void;
  onMoved: () => void;
}

export function GridFolderItem({
  folder,
  autoRename,
  onNavigate,
  onMoved,
}: Props) {
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
              className={cn(
                explorerGridCardClass,
                dragOver && explorerGridCardDragOverClass,
                dragging && 'opacity-40',
              )}
            />
          }
        >
          <div className={explorerGridMediaClass} style={explorerGridFadeMask}>
            <div
              className="absolute inset-0 opacity-95"
              style={explorerGridPlaceholderStyle}
            />
            <div className="relative flex h-full items-center justify-center">
              <div className="flex size-[4.75rem] items-center justify-center rounded-2xl bg-card/80 shadow-elevated backdrop-blur-sm transition-transform duration-300 group-hover:scale-[1.03]">
                <Folder
                  className="size-12 shrink-0"
                  style={folderIconStyle(folder.color)}
                />
              </div>
            </div>
          </div>

          <div className={explorerGridBodyClass}>
            {renaming ? (
              <input
                {...renameInputProps}
                className={explorerGridRenameInputClass}
              />
            ) : (
              <>
                <span
                  className={cn('block', explorerGridTitleClass)}
                  title={folder.name}
                >
                  {folder.name}
                </span>
                <TagList
                  tags={folder.tags}
                  className={explorerGridTagsClass}
                  tagClassName={explorerGridTagClass}
                  overflowClassName={explorerGridTagOverflowClass}
                />
              </>
            )}
          </div>
        </ContextMenuTrigger>
        {menu}
      </ContextMenu>
      {dialogs}
    </>
  );
}
