import { FolderPlus, Import, LayoutGrid } from 'lucide-react';
import { useMessages } from '@myelin/editor/i18n';
import { type FileType, useRepositoryStatus } from '@/lib/sync';
import { useExplorerSetupState } from './explorer/use-explorer-setup-state';

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
  const setupRequired =
    useExplorerSetupState(useRepositoryStatus().config) !== 'ready';

  return [
    {
      id: 'canvas',
      label: strings.library.createNew.canvas,
      icon: LayoutGrid,
      onClick: () =>
        onNewFile?.(strings.library.createNew.untitledCanvas, 'mcanvas'),
      disabled: setupRequired,
    },
    {
      id: 'folder',
      label: strings.library.createNew.folder,
      icon: FolderPlus,
      onClick: onNewFolder,
      disabled: setupRequired,
    },
    {
      id: 'import',
      label: strings.library.createNew.import,
      icon: Import,
      onClick: onImport,
      disabled: importDisabled || setupRequired,
    },
  ];
}
