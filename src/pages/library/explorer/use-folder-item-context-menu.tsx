import { useState } from 'react';
import { ColorPickerDialog } from '@myelin/editor/components/color-picker-dialog';
import { useCustomColors } from '@myelin/editor/custom-colors';
import { Logger } from '@myelin/shared/logger';
import type { VFSFolderNode } from '@/lib/sync';
import { useRepository } from '@/lib/sync';
import { TagManageDialog } from '../tag-manage-dialog';
import { FolderColorSubmenu } from './folder-color-submenu';
import { DEFAULT_FOLDER_COLOR } from './folder-colors';
import { ItemContextMenu } from './item-context-menu';
import { useExplorerItem } from './use-explorer-item';

const logger = new Logger('FolderItemContextMenu');

/**
 * Folder counterpart of `useFileItemContextMenu`: rename, remove, manage tags,
 * and the icon color submenu. Spread `contextMenuProps` onto `<ContextMenu>` —
 * the menu is controlled so a swatch click can close it (swatches aren't
 * menu items).
 */
export function useFolderItemContextMenu(
  node: VFSFolderNode,
  onChanged: () => void | Promise<void>,
  options?: { initialRenaming?: boolean; nodeIds?: readonly string[] },
) {
  const repository = useRepository();
  const { addColor } = useCustomColors('folder');
  const [menuOpen, setMenuOpen] = useState(false);
  const [tagDialogOpen, setTagDialogOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

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
    nodeIds: options?.nodeIds,
    onChanged,
    initialRenaming: options?.initialRenaming,
  });

  const applyColor = async (color: string) => {
    setMenuOpen(false);
    try {
      await repository.setFolderColor(
        node.id,
        color === DEFAULT_FOLDER_COLOR ? null : color,
      );
      await onChanged();
    } catch (error) {
      logger.error('Failed to set folder color', error);
    }
  };

  const menu = (
    <ItemContextMenu
      onRename={startRenaming}
      onRemove={handleRemove}
      onManageTags={() => setTagDialogOpen(true)}
    >
      <FolderColorSubmenu
        color={node.color}
        onSelect={(color) => void applyColor(color)}
        onAddCustom={() => {
          setMenuOpen(false);
          setPickerOpen(true);
        }}
      />
    </ItemContextMenu>
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
      <ColorPickerDialog
        open={pickerOpen}
        initialColor={node.color ?? DEFAULT_FOLDER_COLOR}
        title="Custom color"
        confirmLabel="Add color"
        onConfirm={(hex) => {
          setPickerOpen(false);
          void addColor(hex)
            .then(() => applyColor(hex))
            .catch((error) => {
              logger.error('Failed to add custom color', error);
            });
        }}
        onCancel={() => setPickerOpen(false)}
      />
    </>
  );

  return {
    contextMenuProps: { open: menuOpen, onOpenChange: setMenuOpen },
    renaming,
    renameInputProps,
    dragging,
    handleDragStart,
    handleDragEnd,
    menu,
    dialogs,
  };
}
