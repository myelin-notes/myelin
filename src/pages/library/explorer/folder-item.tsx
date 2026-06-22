import { useState } from 'react';
import { Folder } from 'lucide-react';
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu';
import { formatExplorerItemAccessibleName } from '../accessibility-labels';
import { TagManageDialog } from '../tag-manage-dialog';
import { ItemContextMenu } from './item-context-menu';
import { useDropTarget } from './use-drop-target';
import { useExplorerItem } from './use-explorer-item';

interface FolderItemProps {
  id: string;
  name: string;
  tags: string[];
  autoRename?: boolean;
  onNavigate: () => void;
  onMoved: () => void;
}

export function FolderItem({
  id,
  name,
  tags,
  autoRename,
  onNavigate,
  onMoved,
}: FolderItemProps) {
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
              className={`group flex w-full cursor-pointer items-center gap-3 rounded-lg px-4 py-3 transition-all duration-200 ${
                dragOver
                  ? 'bg-accent/15 ring-1 ring-accent/40'
                  : 'hover:bg-hover-tint'
              } ${dragging ? 'opacity-40' : ''}`}
            />
          }
        >
          <Folder className="size-4 shrink-0 fill-accent-amber text-accent-amber transition-all duration-200 group-hover:fill-accent-amber-strong group-hover:text-accent-amber-strong" />
          {renaming ? (
            <input
              {...renameInputProps}
              className="min-w-0 flex-1 border-primary border-b-2 bg-transparent font-medium text-sm text-text-primary outline-none"
            />
          ) : (
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate font-medium text-sm text-text-primary">
                {name}
              </span>
              {tags.length > 0 && (
                <div className="flex shrink-0 items-center gap-1">
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
            </div>
          )}
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
