import { ChevronRight, LayoutTemplate } from 'lucide-react';
import { useMessages } from '@myelin/editor/i18n';
import { cn } from '@myelin/editor/utils';
import { ContextMenu, ContextMenuTrigger } from '@myelin/ui/context-menu';
import { openNote } from '@/lib/note/navigation';
import type { VFSFileNode, VFSFolderNode } from '@/lib/sync';
import { isTemplatesRoot } from '@/lib/sync/repo/shared';
import { useTabController } from '@/lib/tabs/context';
import { formatExplorerItemAccessibleName } from '@/pages/library/accessibility-labels';
import type { CreateNewActions } from '@/pages/library/create-new-options';
import { getFileTypeIcon } from '@/pages/library/explorer/file-icon';
import { TagList } from '@/pages/library/explorer/tag-list';
import {
  FolderGlyph,
  TemplatesFolderMenu,
  type TemplatesFolderMenuProps,
  useFolderLabel,
} from '@/pages/library/explorer/templates-folder';
import { useDropTarget } from '@/pages/library/explorer/use-drop-target';
import { useFileItemContextMenu } from '@/pages/library/explorer/use-file-item-context-menu';
import { useFolderItemContextMenu } from '@/pages/library/explorer/use-folder-item-context-menu';
import { FolderCreateSubmenu } from './folder-create-submenu';
import { TreeIndentGuides, treeRowPadding } from './indent-guides';

const tagListProps = {
  className: 'flex shrink-0 items-center gap-1',
  tagClassName:
    'rounded-md bg-tag/60 px-1.5 py-0.5 font-medium text-[9px] text-text-tag',
  overflowClassName: 'text-[9px] text-text-muted',
} as const;

interface RowProps {
  depth: number;
  autoRename: boolean;
  /** Text the new-item rename starts with, from a folder name rule. */
  renamePrefill?: string;
  /** Row sits directly in the templates folder. */
  isTemplate?: boolean;
  onRenameEnd: (nodeId: string) => void;
  selected: boolean;
  /** Every selected row id; drag and Remove act on all of them when this row is selected. */
  selectionIds: readonly string[];
  /** Returns true when a modifier key handled the click, so the row skips its default action. */
  onSelect: (e: React.MouseEvent) => boolean;
  onChanged: () => void;
  /** Reports a drag entering or leaving this row; the tree highlights the folder it drops into. */
  onDropHover: (over: boolean) => void;
}

interface FolderRowProps extends RowProps {
  node: VFSFolderNode;
  expanded: boolean;
  /** A drag is over this folder or one of its direct children. */
  dropHighlighted: boolean;
  onToggle: () => void;
  onNewFolder: () => void;
  onNewFile: NonNullable<CreateNewActions['onNewFile']>;
  onImport: () => void;
  importDisabled: boolean;
  /** Only used by the templates folder's menu. */
  onImportTemplate: () => void;
}

export function SidebarFolderRow({
  node,
  depth,
  expanded,
  dropHighlighted,
  autoRename,
  renamePrefill,
  onRenameEnd,
  selected,
  selectionIds,
  onSelect,
  onToggle,
  onNewFolder,
  onNewFile,
  onImport,
  importDisabled,
  onImportTemplate,
  onChanged,
  onDropHover,
}: FolderRowProps) {
  const {
    contextMenuProps,
    renaming,
    dragging,
    handleDragStart,
    handleDragEnd,
    renameInputProps,
    menu,
    dialogs,
  } = useFolderItemContextMenu(node, onChanged, {
    nodeIds: selected ? selectionIds : undefined,
    initialRenaming: autoRename,
    initialRenameValue: renamePrefill,
    onRenameEnd,
    createSubmenu: (
      <FolderCreateSubmenu
        onNewFolder={onNewFolder}
        onNewFile={onNewFile}
        onImport={onImport}
        importDisabled={importDisabled}
      />
    ),
  });
  const strings = useMessages();
  const label = useFolderLabel(node);
  const templatesRoot = isTemplatesRoot(node);
  const { dropTargetProps } = useDropTarget({
    targetFolderId: node.id,
    onMoved: onChanged,
    onDragOverChange: onDropHover,
  });

  return (
    <>
      <ContextMenu {...contextMenuProps}>
        <ContextMenuTrigger
          render={
            <button
              type="button"
              draggable={!renaming && !templatesRoot}
              onClick={(e) => {
                if (!renaming && !onSelect(e)) {
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
                  : formatExplorerItemAccessibleName(label, node.tags)
              }
              className={cn(
                'group relative flex h-7 w-full cursor-pointer items-center gap-1.5 rounded-md pr-2 transition-colors duration-150',
                selected && 'bg-hover-tint',
                dropHighlighted
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
          <FolderGlyph folder={node} className="size-4 shrink-0" />
          {renaming ? (
            <input
              {...renameInputProps}
              className="min-w-0 flex-1 border-primary border-b bg-transparent font-medium text-[13px] text-text-primary outline-none"
            />
          ) : (
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
              <span className="truncate font-medium text-[13px] text-text-primary">
                {label}
              </span>
              <TagList tags={node.tags} {...tagListProps} />
            </div>
          )}
        </ContextMenuTrigger>
        {templatesRoot ? (
          <TemplatesFolderMenu
            onNewTemplate={() =>
              onNewFile(
                strings.library.createNew.untitledCanvas,
                'mcanvas',
                null,
              )
            }
            onImportTemplate={onImportTemplate}
          />
        ) : (
          menu
        )}
      </ContextMenu>
      {dialogs}
    </>
  );
}

/** Stands in for the templates folder until it exists; it is created on first use, not on load,
 * so a device that hasn't synced yet can't add a second templates folder. */
export function SidebarTemplatesPlaceholderRow({
  onOpen,
  ...menuProps
}: TemplatesFolderMenuProps & { onOpen: () => void }) {
  const strings = useMessages();
  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <button
            type="button"
            onClick={onOpen}
            aria-expanded={false}
            style={{ paddingLeft: treeRowPadding(0) }}
            className="group relative flex h-7 w-full cursor-pointer items-center gap-1.5 rounded-md pr-2 transition-colors duration-150 hover:bg-hover-tint"
          />
        }
      >
        <ChevronRight className="size-3.5 shrink-0 text-text-muted" />
        <LayoutTemplate className="size-4 shrink-0 text-emerald-600 dark:text-accent" />
        <span className="truncate font-medium text-[13px] text-text-primary">
          {strings.library.templates.title}
        </span>
      </ContextMenuTrigger>
      <TemplatesFolderMenu {...menuProps} />
    </ContextMenu>
  );
}

interface FileRowProps extends RowProps {
  node: VFSFileNode;
}

export function SidebarFileRow({
  node,
  depth,
  autoRename,
  renamePrefill,
  isTemplate,
  onRenameEnd,
  selected,
  selectionIds,
  onSelect,
  onChanged,
  onDropHover,
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
  } = useFileItemContextMenu(node, onChanged, {
    initialRenaming: autoRename,
    initialRenameValue: renamePrefill,
    isTemplate,
    onRenameEnd,
    nodeIds: selected ? selectionIds : undefined,
  });
  const { dropTargetProps } = useDropTarget({
    targetFolderId: node.parentId,
    onMoved: onChanged,
    onDragOverChange: onDropHover,
  });
  const FileIcon = getFileTypeIcon(node.fileType);

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger
          render={
            <button
              type="button"
              draggable={!renaming}
              onClick={(e) => {
                if (!renaming && !onSelect(e)) {
                  openNote(tabController, node, node.name);
                }
              }}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              // Root-level files let the drop bubble to the tree's root target.
              {...(node.parentId === null ? {} : dropTargetProps)}
              style={{ paddingLeft: treeRowPadding(depth) }}
              aria-label={
                renaming
                  ? undefined
                  : formatExplorerItemAccessibleName(node.name, node.tags)
              }
              className={cn(
                'group relative flex h-7 w-full cursor-pointer items-center gap-1.5 rounded-md pr-2 transition-colors duration-150 hover:bg-hover-tint',
                selected && 'bg-hover-tint',
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
