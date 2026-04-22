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
                'group relative flex w-full min-w-0 cursor-pointer flex-col overflow-hidden rounded-xl text-left transition-all duration-200 ease-out',
                dragOver
                  ? 'bg-accent/15 ring-1 ring-accent/40'
                  : 'bg-surface hover:-translate-y-0.5 hover:bg-card hover:shadow-ambient',
              )}
            />
          }
        >
          <div className="relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden">
            <Folder className="size-14 shrink-0 fill-amber-400 text-amber-400 transition-colors duration-200 group-hover:fill-amber-500 group-hover:text-amber-500" />
          </div>

          <div className="flex min-w-0 flex-col gap-1.5 px-3 py-3">
            {renaming ? (
              <input
                {...renameInputProps}
                className="w-full border-primary border-b-2 bg-transparent font-medium text-sm text-text-primary outline-none"
              />
            ) : (
              <>
                <span
                  className="block truncate font-medium text-sm text-text-primary"
                  title={name}
                >
                  {name}
                </span>
                {tags.length > 0 && (
                  <div className="flex min-w-0 flex-wrap items-center gap-1">
                    {tags.slice(0, 2).map((tag) => (
                      <span
                        key={tag}
                        className="rounded-md bg-tag/60 px-1.5 py-0.5 font-medium text-[9px] text-text-tag"
                      >
                        #{tag}
                      </span>
                    ))}
                    {tags.length > 2 && (
                      <span className="text-[9px] text-text-muted">
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
