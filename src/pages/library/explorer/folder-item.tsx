import { ContextMenu, ContextMenuTrigger } from '@myelin/ui/context-menu';
import type { VFSFolderNode } from '@/lib/sync';
import { isTemplatesRoot } from '@/lib/sync/repo/shared';
import { formatExplorerItemAccessibleName } from '../accessibility-labels';
import { TagList } from './tag-list';
import { FolderGlyph, useFolderLabel } from './templates-folder';
import { useDropTarget } from './use-drop-target';
import { useFolderItemContextMenu } from './use-folder-item-context-menu';

interface FolderItemProps {
  folder: VFSFolderNode;
  autoRename?: boolean;
  onRenameEnd?: (nodeId: string) => void;
  onNavigate: () => void;
  onMoved: () => void;
}

export function FolderItem({
  folder,
  autoRename,
  onRenameEnd,
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
    onRenameEnd,
  });

  const label = useFolderLabel(folder);
  const templatesRoot = isTemplatesRoot(folder);
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
              draggable={!renaming && !templatesRoot}
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
                  : formatExplorerItemAccessibleName(label, folder.tags)
              }
              className={`group flex w-full cursor-pointer items-center gap-3 rounded-lg px-4 py-3 transition-all duration-200 ${
                dragOver
                  ? 'bg-accent/15 ring-1 ring-accent/40'
                  : 'hover:bg-hover-tint'
              } ${dragging ? 'opacity-40' : ''}`}
            />
          }
        >
          <FolderGlyph folder={folder} className="size-4 shrink-0" />
          {renaming ? (
            <input
              {...renameInputProps}
              className="min-w-0 flex-1 border-primary border-b-2 bg-transparent font-medium text-sm text-text-primary outline-none"
            />
          ) : (
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate font-medium text-sm text-text-primary">
                {label}
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
        {!templatesRoot && menu}
      </ContextMenu>
      {dialogs}
    </>
  );
}
