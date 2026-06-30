import { useState } from 'react';
import { ChevronRight, FileText, Folder } from 'lucide-react';
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu';
import { VersionHistoryDialog } from '@/components/version-history-dialog';
import { openNote } from '@/lib/note/navigation';
import type { VFSFileNode, VFSFolderNode } from '@/lib/sync';
import { useTabController } from '@/lib/tabs/context';
import { cn } from '@/lib/utils';
import { formatExplorerItemAccessibleName } from '@/pages/library/accessibility-labels';
import { ItemContextMenu } from '@/pages/library/explorer/item-context-menu';
import { RenameReferencesDialog } from '@/pages/library/explorer/rename-references-dialog';
import { TagList } from '@/pages/library/explorer/tag-list';
import { useDropTarget } from '@/pages/library/explorer/use-drop-target';
import { useExplorerItem } from '@/pages/library/explorer/use-explorer-item';
import { TagManageDialog } from '@/pages/library/tag-manage-dialog';

const ROW_BASE_PADDING = 8;
const ROW_DEPTH_INDENT = 14;

function rowPadding(depth: number): string {
  return `${ROW_BASE_PADDING + depth * ROW_DEPTH_INDENT}px`;
}

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
              style={{ paddingLeft: rowPadding(depth) }}
              aria-expanded={expanded}
              aria-label={
                renaming
                  ? undefined
                  : formatExplorerItemAccessibleName(node.name, node.tags)
              }
              className={cn(
                'group flex h-7 w-full cursor-pointer items-center gap-1.5 rounded-md pr-2 transition-colors duration-150',
                dragOver
                  ? 'bg-accent/15 ring-1 ring-accent/40'
                  : 'hover:bg-hover-tint',
                dragging && 'opacity-40',
              )}
            />
          }
        >
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
    nodeId: node.id,
    name: node.name,
    dragKind: 'file',
    onChanged,
    initialRenaming: autoRename,
    renameReferencesOnRename: node.fileType === 'mcanvas',
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
                  openNote(tabController, node, node.name, 'explorer');
                }
              }}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              style={{ paddingLeft: rowPadding(depth) }}
              aria-label={
                renaming
                  ? undefined
                  : formatExplorerItemAccessibleName(node.name, node.tags)
              }
              className={cn(
                'group flex h-7 w-full cursor-pointer items-center gap-1.5 rounded-md pr-2 transition-colors duration-150 hover:bg-hover-tint',
                dragging && 'opacity-40',
              )}
            />
          }
        >
          <FileText className="size-3.5 shrink-0 text-text-muted transition-colors duration-150 group-hover:text-text-secondary" />
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
        <ItemContextMenu
          onRename={startRenaming}
          onRemove={handleRemove}
          onManageTags={() => setTagDialogOpen(true)}
          onVersionHistory={() => setVersionHistoryOpen(true)}
        />
      </ContextMenu>
      <TagManageDialog
        open={tagDialogOpen}
        onOpenChange={setTagDialogOpen}
        nodeId={node.id}
        nodeName={node.name}
        onChanged={onChanged}
      />
      <VersionHistoryDialog
        open={versionHistoryOpen}
        onOpenChange={setVersionHistoryOpen}
        fileId={node.id}
        fileName={node.name}
        fileType={node.fileType}
        onRestored={onChanged}
      />
      <RenameReferencesDialog
        prompt={renameReferencesPrompt}
        onChoice={chooseRenameReferences}
      />
    </>
  );
}
