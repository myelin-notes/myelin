import { useState } from 'react';
import { Folder } from 'lucide-react';
import { ContextMenu, ContextMenuTrigger } from '@myelin/ui/context-menu';
import { cn } from '@/lib/utils';
import { formatExplorerItemAccessibleName } from '../../accessibility-labels';
import { TagManageDialog } from '../../tag-manage-dialog';
import { ItemContextMenu } from '../item-context-menu';
import { TagList } from '../tag-list';
import { useDropTarget } from '../use-drop-target';
import { useExplorerItem } from '../use-explorer-item';
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
  id: string;
  name: string;
  tags: string[];
  autoRename?: boolean;
  onNavigate: () => void;
  onMoved: () => void;
}

export function GridFolderItem({
  id,
  name,
  tags,
  autoRename,
  onNavigate,
  onMoved,
}: Props) {
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
    nodeId: id,
    name,
    dragKind: 'folder',
    onChanged: onMoved,
    initialRenaming: autoRename,
  });

  const { dragOver, dropTargetProps } = useDropTarget({
    targetFolderId: id,
    onMoved,
  });

  return (
    <>
      <ContextMenu>
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
                  : formatExplorerItemAccessibleName(name, tags)
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
                <Folder className="size-12 shrink-0 fill-accent-amber text-accent-amber transition-colors duration-200 group-hover:fill-accent-amber-strong group-hover:text-accent-amber-strong" />
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
                  title={name}
                >
                  {name}
                </span>
                <TagList
                  tags={tags}
                  className={explorerGridTagsClass}
                  tagClassName={explorerGridTagClass}
                  overflowClassName={explorerGridTagOverflowClass}
                />
              </>
            )}
          </div>
        </ContextMenuTrigger>
        <ItemContextMenu
          onRename={startRenaming}
          onRemove={handleRemove}
          onManageTags={() => setTagDialogOpen(true)}
        />
      </ContextMenu>
      <TagManageDialog
        open={tagDialogOpen}
        onOpenChange={setTagDialogOpen}
        nodeId={id}
        nodeName={name}
        onChanged={onMoved}
      />
    </>
  );
}
