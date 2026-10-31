import { FolderPlus, Import, LayoutGrid } from 'lucide-react';
import { useMessages } from '@myelin/editor/i18n';
import { holdVirtualKeyboard } from '@/lib/hold-virtual-keyboard';
import type { FileType } from '@/lib/sync';

export interface CreateNewActions {
  onNewFolder?: () => void;
  onNewFile?: (title: string, type: FileType) => void;
  onImport?: () => void;
  importDisabled?: boolean;
}

export const createNewItemClass =
  'gap-2.5 rounded-md px-3 py-2 text-sm text-text-secondary focus:bg-surface focus:text-text-primary';

export function useCreateNewOptions({
  onNewFolder,
  onNewFile,
  onImport,
  importDisabled = false,
}: CreateNewActions) {
  const strings = useMessages();

  return [
    {
      id: 'canvas',
      label: strings.library.createNew.canvas,
      icon: LayoutGrid,
      onClick: () => {
        holdVirtualKeyboard();
        onNewFile?.(strings.library.createNew.untitledCanvas, 'mcanvas');
      },
    },
    {
      id: 'folder',
      label: strings.library.createNew.folder,
      icon: FolderPlus,
      onClick: () => {
        holdVirtualKeyboard();
        onNewFolder?.();
      },
    },
    {
      id: 'import',
      label: strings.library.createNew.import,
      icon: Import,
      onClick: onImport,
      disabled: importDisabled,
    },
  ];
}
