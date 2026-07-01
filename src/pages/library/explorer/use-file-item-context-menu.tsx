import { useState } from 'react';
import { VersionHistoryDialog } from '@/components/version-history-dialog';
import type { VFSFileNode } from '@/lib/sync';
import { TagManageDialog } from '../tag-manage-dialog';
import { ItemContextMenu } from './item-context-menu';
import { RenameReferencesDialog } from './rename-references-dialog';
import { useExplorerItem } from './use-explorer-item';

/**
 * Shared wiring for a file item's right-click menu: rename (with note-reference
 * updates for canvases), remove, manage tags, and version history, plus the
 * dialogs those actions open. Used by both the sidebar file row and the home
 * page's recent cards so the menu stays identical in both places.
 *
 * Returns the rename/drag primitives to spread onto the trigger, the `menu`
 * element to place inside `<ContextMenu>`, and the `dialogs` to render alongside.
 */
export function useFileItemContextMenu(
  node: VFSFileNode,
  onChanged: () => void | Promise<void>,
  options?: { initialRenaming?: boolean },
) {
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
    initialRenaming: options?.initialRenaming,
    renameReferencesOnRename: node.fileType === 'mcanvas',
  });

  const menu = (
    <ItemContextMenu
      onRename={startRenaming}
      onRemove={handleRemove}
      onManageTags={() => setTagDialogOpen(true)}
      onVersionHistory={() => setVersionHistoryOpen(true)}
    />
  );

  const dialogs = (
    <>
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

  return {
    renaming,
    renameInputProps,
    dragging,
    handleDragStart,
    handleDragEnd,
    menu,
    dialogs,
  };
}
