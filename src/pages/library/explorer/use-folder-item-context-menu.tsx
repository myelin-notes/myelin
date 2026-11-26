import { type ReactNode, useState } from 'react';
import { Settings2 } from 'lucide-react';
import { ColorPickerDialog } from '@myelin/editor/components/color-picker-dialog';
import { useCustomColors } from '@myelin/editor/custom-colors';
import { useMessages } from '@myelin/editor/i18n';
import { Logger } from '@myelin/shared/logger';
import { ContextMenuItem } from '@myelin/ui/context-menu';
import type { VFSFolderNode } from '@/lib/sync';
import { useRepository } from '@/lib/sync';
import { TagManageDialog } from '../tag-manage-dialog';
import { FolderColorSubmenu } from './folder-color-submenu';
import { DEFAULT_FOLDER_COLOR } from './folder-colors';
import { FolderSettingsDialog } from './folder-settings-dialog';
import { ItemContextMenu } from './item-context-menu';
import { MoveItemDialog } from './move-item-dialog';
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
  options?: {
    initialRenaming?: boolean;
    initialRenameValue?: string;
    onRenameEnd?: (nodeId: string) => void;
    nodeIds?: readonly string[];
    createSubmenu?: ReactNode;
  },
) {
  const repository = useRepository();
  const { addColor } = useCustomColors('folder');
  const strings = useMessages();
  const [menuOpen, setMenuOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [tagDialogOpen, setTagDialogOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

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
    initialRenameValue: options?.initialRenameValue,
    onRenameEnd: options?.onRenameEnd,
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
      onMove={() => setMoveOpen(true)}
      onRename={startRenaming}
      onRemove={handleRemove}
      onManageTags={() => setTagDialogOpen(true)}
      createSubmenu={options?.createSubmenu}
    >
      <FolderColorSubmenu
        color={node.color}
        onSelect={(color) => void applyColor(color)}
        onAddCustom={() => {
          setMenuOpen(false);
          setPickerOpen(true);
        }}
      />
      <ContextMenuItem
        className="gap-2.5 rounded-md px-3 py-2 text-sm text-text-secondary focus:bg-surface focus:text-text-primary"
        onClick={() => setSettingsOpen(true)}
      >
        <Settings2 className="size-4" />
        {strings.library.folderSettings.menuItem}
      </ContextMenuItem>
    </ItemContextMenu>
  );

  const dialogs = (
    <>
      <MoveItemDialog
        open={moveOpen}
        onOpenChange={setMoveOpen}
        nodeIds={options?.nodeIds ?? [node.id]}
        onChanged={onChanged}
      />
      <TagManageDialog
        open={tagDialogOpen}
        onOpenChange={setTagDialogOpen}
        nodeId={node.id}
        nodeName={node.name}
        onChanged={onChanged}
      />
      <FolderSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        folder={node}
        onChanged={onChanged}
      />
      <ColorPickerDialog
        open={pickerOpen}
        initialColor={node.color ?? DEFAULT_FOLDER_COLOR}
        title={strings.colorPicker.customColor}
        confirmLabel={strings.colorPicker.addColor}
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
