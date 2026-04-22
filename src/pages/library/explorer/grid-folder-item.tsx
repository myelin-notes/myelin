import { useState } from 'react';
import { Folder } from 'lucide-react';
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu';
import { cn } from '@/lib/utils';
import { TagManageDialog } from '../tag-manage-dialog';
import {
  explorerGridBodyClass,
  explorerGridCardClass,
  explorerGridCardDragOverClass,
  explorerGridMediaClass,
  explorerGridPlaceholderStyle,
  explorerGridRenameInputClass,
  explorerGridTagClass,
  explorerGridTagOverflowClass,
  explorerGridTagsClass,
  explorerGridTitleClass,
} from './grid-item-styles';
import { ItemContextMenu } from './item-context-menu';
import { useDropTarget } from './use-drop-target';
import { useExplorerItem } from './use-explorer-item';

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
    startRenaming,
    handleRemove,
    handleDragStart,
    renameInputProps,
  } = useExplorerItem({
    nodeId: id,
    name,
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
              {...dropTargetProps}
              className={cn(
                explorerGridCardClass,
                dragOver && explorerGridCardDragOverClass,
              )}
            />
          }
        >
          <div className={explorerGridMediaClass}>
            <div
              className="absolute inset-0 opacity-95"
              style={explorerGridPlaceholderStyle}
            />
            <div className="relative flex h-full items-center justify-center">
              <div className="flex size-[4.75rem] items-center justify-center rounded-[1.35rem] bg-card/80 shadow-[0_18px_40px_-24px_rgba(28,39,56,0.7)] ring-1 ring-white/55 backdrop-blur-sm transition-transform duration-300 group-hover:scale-[1.03]">
                <Folder className="size-12 shrink-0 fill-amber-400 text-amber-400 transition-colors duration-200 group-hover:fill-amber-500 group-hover:text-amber-500" />
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
                {tags.length > 0 && (
                  <div className={explorerGridTagsClass}>
                    {tags.slice(0, 2).map((tag) => (
                      <span key={tag} className={explorerGridTagClass}>
                        #{tag}
                      </span>
                    ))}
                    {tags.length > 2 && (
                      <span className={explorerGridTagOverflowClass}>
                        +{tags.length - 2}
                      </span>
                    )}
                  </div>
                )}
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
