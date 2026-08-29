import { useState } from 'react';
import { ChevronRight, Folder } from 'lucide-react';
import { cn } from '@myelin/editor/utils';
import { ContextMenu, ContextMenuTrigger } from '@myelin/ui/context-menu';
import { openNote } from '@/lib/note/navigation';
import type { VFSFileNode, VFSFolderNode } from '@/lib/sync';
import { useTabController } from '@/lib/tabs/context';
import { formatExplorerItemAccessibleName } from '@/pages/library/accessibility-labels';
import { getFileTypeIcon } from '@/pages/library/explorer/file-icon';
import { ItemContextMenu } from '@/pages/library/explorer/item-context-menu';
import { TagList } from '@/pages/library/explorer/tag-list';
import { useDropTarget } from '@/pages/library/explorer/use-drop-target';
import { useExplorerItem } from '@/pages/library/explorer/use-explorer-item';
import { useFileItemContextMenu } from '@/pages/library/explorer/use-file-item-context-menu';
import { TagManageDialog } from '@/pages/library/tag-manage-dialog';
import { TreeIndentGuides, treeRowPadding } from './indent-guides';

const tagListProps = {
  className: 'flex shrink-0 items-center gap-1',
  tagClassName:
    'rounded-md bg-tag/60 px-1.5 py-0.5 font-medium text-[9px] text-text-tag',
  overflowClassName: 'text-[9px] text-text-muted',
} as const;

interface FolderRowProps {
  node: VFSFolderNode;
  depth: number;
  expanded: boolean;
  autoRename: boolean;
  onToggle: () => void;
  onChanged: () => void;
}

export function SidebarFolderRow({
  node,
  depth,
  expanded,
  autoRename,
  onToggle,
  onChanged,
}: FolderRowProps) {
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
    nodeId: node.id,
    name: node.name,
    dragKind: 'folder',
    onChanged,
    initialRenaming: autoRename,
  });
  const { dragOver, dropTargetProps } = useDropTarget({
    targetFolderId: node.id,
    onMoved: onChanged,
  });

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger
          render={
            <button
              type="button"
              draggable={!renaming}
              onClick={() => {
                if (!renaming) {
                  onToggle();
                }
              }}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              {...dropTargetProps}
              style={{ paddingLeft: treeRowPadding(depth) }}
              aria-expanded={expanded}
              aria-label={
                renaming
                  ? undefined
                  : formatExplorerItemAccessibleName(node.name, node.tags)
              }
              className={cn(
                'group relative flex h-7 w-full cursor-pointer items-center gap-1.5 rounded-md pr-2 transition-colors duration-150',
                dragOver
                  ? 'bg-accent/15 ring-1 ring-accent/40'
                  : 'hover:bg-hover-tint',
                dragging && 'opacity-40',
              )}
            />
          }
        >
          <TreeIndentGuides depth={depth} />
          <ChevronRight
            className={cn(
              'size-3.5 shrink-0 text-text-muted transition-transform duration-150',
              expanded && 'rotate-90',
            )}
          />
          <Folder className="size-4 shrink-0 fill-accent-amber text-accent-amber transition-colors duration-150 group-hover:fill-accent-amber-strong group-hover:text-accent-amber-strong" />
          {renaming ? (
            <input
              {...renameInputProps}
              className="min-w-0 flex-1 border-primary border-b bg-transparent font-medium text-[13px] text-text-primary outline-none"
            />
          ) : (
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
              <span className="truncate font-medium text-[13px] text-text-primary">
                {node.name}
              </span>
              <TagList tags={node.tags} {...tagListProps} />
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
        nodeId={node.id}
        nodeName={node.name}
        onChanged={onChanged}
      />
    </>
  );
}

interface FileRowProps {
  node: VFSFileNode;
  depth: number;
  autoRename: boolean;
  onChanged: () => void;
}

export function SidebarFileRow({
  node,
  depth,
  autoRename,
  onChanged,
}: FileRowProps) {
  const tabController = useTabController();
  const {
    renaming,
    dragging,
    handleDragStart,
    handleDragEnd,
    renameInputProps,
    menu,
    dialogs,
  } = useFileItemContextMenu(node, onChanged, { initialRenaming: autoRename });
  const FileIcon = getFileTypeIcon(node.fileType);

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger
          render={
            <button
              type="button"
              draggable={!renaming}
              onClick={() => {
                if (!renaming) {
                  openNote(tabController, node, node.name, 'explorer');
                }
              }}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              style={{ paddingLeft: treeRowPadding(depth) }}
              aria-label={
                renaming
                  ? undefined
                  : formatExplorerItemAccessibleName(node.name, node.tags)
              }
              className={cn(
                'group relative flex h-7 w-full cursor-pointer items-center gap-1.5 rounded-md pr-2 transition-colors duration-150 hover:bg-hover-tint',
                dragging && 'opacity-40',
              )}
            />
          }
        >
          <TreeIndentGuides depth={depth} />
          <FileIcon className="size-3.5 shrink-0 text-text-muted transition-colors duration-150 group-hover:text-text-secondary" />
          {renaming ? (
            <input
              {...renameInputProps}
              className="min-w-0 flex-1 border-primary border-b bg-transparent font-normal text-[13px] text-text-secondary outline-none"
            />
          ) : (
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
              <span className="truncate font-normal text-[13px] text-text-secondary transition-colors duration-150 group-hover:text-text-primary">
                {node.name}
              </span>
              <TagList tags={node.tags} {...tagListProps} />
            </div>
          )}
        </ContextMenuTrigger>
        {menu}
      </ContextMenu>
      {dialogs}
    </>
  );
}
