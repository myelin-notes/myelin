import {
  FolderPlus,
  Import,
  LayoutGrid,
  LayoutTemplate,
  Plus,
} from 'lucide-react';
import { useMessages } from '@myelin/editor/i18n';
import { useTemplates } from '@/lib/note/use-templates';
import { type FileType, useRepositoryStatus, type VFSNodeId } from '@/lib/sync';
import { useExplorerSetupState } from './explorer/use-explorer-setup-state';

export interface CreateNewActions {
  onNewFolder?: () => void;
  /** `templateId`: `undefined` uses the folder's default template, `null` forces a blank canvas. */
  onNewFile?: (
    title: string,
    type: FileType,
    templateId?: VFSNodeId | null,
  ) => void;
  onImport?: () => void;
  importDisabled?: boolean;
  /** Set when the current folder is the templates folder; the menu then offers only template actions. */
  onImportTemplate?: () => void;
}

export const createNewItemClass =
  'gap-2.5 rounded-md px-3 py-2 text-sm text-text-secondary focus:bg-surface focus:text-text-primary';

export interface CreateNewChoice {
  id: string;
  label: string;
  onClick: () => void;
}

export function useCreateNewOptions({
  onNewFolder,
  onNewFile,
  onImport,
  importDisabled = false,
  onImportTemplate,
}: CreateNewActions) {
  const strings = useMessages();
  const setupRequired =
    useExplorerSetupState(useRepositoryStatus().config) !== 'ready';
  const { templates } = useTemplates();
  const newCanvas = (templateId?: VFSNodeId | null) =>
    onNewFile?.(
      strings.library.createNew.untitledCanvas,
      'mcanvas',
      templateId,
    );

  if (onImportTemplate) {
    return [
      {
        id: 'new-template',
        label: strings.library.templates.newTemplate,
        icon: Plus,
        onClick: () => newCanvas(null),
        choices: undefined,
        disabled: setupRequired,
      },
      {
        id: 'import-template',
        label: strings.library.templates.importTemplate,
        icon: Import,
        onClick: onImportTemplate,
        choices: undefined,
        disabled: setupRequired,
      },
    ];
  }

  return [
    {
      id: 'canvas',
      label: strings.library.createNew.canvas,
      icon: LayoutGrid,
      onClick: () => newCanvas(),
      choices: undefined,
      disabled: setupRequired,
    },
    ...(templates.length > 0
      ? [
          {
            id: 'from-template',
            label: strings.library.templates.fromTemplate,
            icon: LayoutTemplate,
            onClick: undefined,
            /** A blank canvas first, then one entry per template. */
            choices: [
              {
                id: 'blank',
                label: strings.library.templates.blankCanvas,
                onClick: () => newCanvas(null),
              },
              ...templates.map(
                (template): CreateNewChoice => ({
                  id: template.id,
                  label: template.name,
                  onClick: () => newCanvas(template.id),
                }),
              ),
            ],
            disabled: setupRequired,
          },
        ]
      : []),
    {
      id: 'folder',
      label: strings.library.createNew.folder,
      icon: FolderPlus,
      onClick: onNewFolder,
      choices: undefined,
      disabled: setupRequired,
    },
    {
      id: 'import',
      label: strings.library.createNew.import,
      icon: Import,
      onClick: onImport,
      choices: undefined,
      disabled: importDisabled || setupRequired,
    },
  ];
}
