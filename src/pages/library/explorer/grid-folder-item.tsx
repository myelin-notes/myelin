import { useState } from 'react';
import { Folder } from 'lucide-react';
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu';
import { cn } from '@/lib/utils';
import { TagManageDialog } from '../tag-manage-dialog';
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
                'group relative flex w-full min-w-0 cursor-pointer flex-col overflow-hidden rounded-xl text-left transition-all duration-200',
                dragOver
                  ? 'bg-accent/15 ring-1 ring-accent/40'
                  : 'bg-surface hover:bg-card hover:shadow-ambient',
              )}
            />
          }
        >
          <div className="relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-amber-200/40 via-transparent to-amber-50/30" />
            <Folder className="relative size-12 fill-amber-400/90 text-amber-500 transition-transform duration-300 group-hover:scale-105" />
          </div>

          <div className="flex-none px-3 py-2.5">
            {renaming ? (
              <input
                {...renameInputProps}
                className="w-full border-primary border-b-2 bg-transparent font-semibold text-[13px] text-text-primary outline-none"
              />
            ) : (
              <div className="flex min-w-0 items-center gap-1.5">
                <span
                  className="truncate font-semibold text-[13px] text-text-primary"
                  title={name}
                >
                  {name}
                </span>
              </div>
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
