import {
  BookOpen,
  FileText,
  Grid2X2,
  Keyboard,
  Plus,
  RefreshCw,
} from 'lucide-react';
import type { Messages } from '@/lib/i18n';
import { type Action, registry } from '@/lib/keybinds';
import {
  getActionCategory,
  getActionCopy,
  getActionIcon,
} from '@/lib/keybinds/messages';
import type {
  CommandPaletteItem,
  CommandPaletteMode,
  CommandPalettePage,
} from './types';

export interface CommandPaletteItemContext {
  activeKeybindingActions: Action[];
  currentPage: CommandPalettePage;
  strings: Messages;
  isImportingMarkdown: boolean;
  isRefreshingRepository: boolean;
  canRefreshRepository: boolean;
  createNote: () => Promise<void>;
  openPalette: (mode: CommandPaletteMode) => void;
  refreshRepository: () => void;
  toggleLibraryView: () => void;
  triggerKeybindingAction: (action: Action) => void;
  triggerCanvasMarkdownImport: () => void;
  triggerLibraryMarkdownImport: () => void;
}

export function createCommandPaletteItems({
  activeKeybindingActions,
  currentPage,
  strings,
  isImportingMarkdown,
  isRefreshingRepository,
  canRefreshRepository,
  createNote,
  openPalette,
  refreshRepository,
  toggleLibraryView,
  triggerKeybindingAction,
  triggerCanvasMarkdownImport,
  triggerLibraryMarkdownImport,
}: CommandPaletteItemContext): CommandPaletteItem[] {
  const items: CommandPaletteItem[] = [
    {
      id: 'open-note',
      label: strings.commandPalette.commands.openNote.label,
      description: strings.commandPalette.commands.openNote.description,
      keywords: ['canvas', 'file', 'recent'],
      section: strings.commandPalette.sections.commands,
      icon: BookOpen,
      onSelect: () => openPalette('notes'),
    },
    {
      id: 'create-note',
      label: strings.commandPalette.commands.createNote.label,
      description: strings.commandPalette.commands.createNote.description,
      keywords: ['new', 'canvas'],
      section: strings.commandPalette.sections.commands,
      icon: Plus,
      onSelect: createNote,
    },
    {
      id: 'import-markdown-library',
      label: strings.commandPalette.commands.importMarkdown.label,
      description: strings.commandPalette.commands.importMarkdown.description,
      keywords: ['markdown', 'md', 'file'],
      section: strings.commandPalette.sections.commands,
      icon: FileText,
      disabled: isImportingMarkdown,
      visibleOn: ['library'],
      onSelect: triggerLibraryMarkdownImport,
    },
    {
      id: 'import-markdown-canvas',
      label: strings.commandPalette.commands.importMarkdownToCanvas.label,
      description:
        strings.commandPalette.commands.importMarkdownToCanvas.description,
      keywords: ['markdown', 'md', 'file', 'page', 'frame'],
      section: strings.commandPalette.sections.commands,
      icon: FileText,
      disabled: isImportingMarkdown,
      visibleOn: ['canvas'],
      onSelect: triggerCanvasMarkdownImport,
    },
    {
      id: 'switch-library-view',
      label: strings.commandPalette.commands.switchView.label,
      description: strings.commandPalette.commands.switchView.description,
      keywords: ['grid', 'list', 'tree'],
      section: strings.commandPalette.sections.commands,
      icon: Grid2X2,
      visibleOn: ['library'],
      onSelect: toggleLibraryView,
    },
    ...(canRefreshRepository
      ? [
          {
            id: 'refresh-repository',
            label: strings.commandPalette.commands.refreshRepository.label,
            description:
              strings.commandPalette.commands.refreshRepository.description,
            keywords: ['sync', 'pull', 'remote', 'repository'],
            section: strings.commandPalette.sections.commands,
            icon: RefreshCw,
            disabled: isRefreshingRepository,
            visibleOn: ['library' as const],
            onSelect: refreshRepository,
          },
        ]
      : []),
    ...createKeybindingCommandPaletteItems({
      actions: activeKeybindingActions,
      strings,
      triggerKeybindingAction,
    }),
  ];

  return items.filter((item) => isCommandPaletteItemVisible(item, currentPage));
}

export function commandPaletteShortcut(): string {
  return registry.format('app:command-palette');
}

export function commandPalettePageFromTabTarget(
  target: import('@/lib/tabs/types').TabTarget | null,
): CommandPalettePage {
  if (!target) return 'library';
  switch (target.type) {
    case 'library':
      return 'library';
    case 'canvas':
      return 'canvas';
    case 'settings':
      return 'settings';
    case 'image':
      return 'unknown';
  }
}

function isCommandPaletteItemVisible(
  item: CommandPaletteItem,
  currentPage: CommandPalettePage,
): boolean {
  return !item.visibleOn || item.visibleOn.includes(currentPage);
}

function createKeybindingCommandPaletteItems({
  actions,
  strings,
  triggerKeybindingAction,
}: {
  actions: Action[];
  strings: Messages;
  triggerKeybindingAction: (action: Action) => void;
}): CommandPaletteItem[] {
  return actions
    .filter((action) => action !== 'app:command-palette')
    .flatMap((action) => {
      const copy = getActionCopy(strings, action);
      if (!copy) {
        return [];
      }
      const icon = getActionIcon(action) ?? Keyboard;

      return [
        {
          id: `action:${action}`,
          label: copy.label,
          description: copy.description ?? action,
          keywords: [...action.split(':'), action],
          section: getActionCategory(strings, action),
          icon,
          shortcut: registry.format(action) || undefined,
          onSelect: () => triggerKeybindingAction(action),
        },
      ];
    });
}