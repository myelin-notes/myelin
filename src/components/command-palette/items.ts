import {
  BookOpen,
  FileText,
  Keyboard,
  Network,
  Plus,
  RefreshCw,
} from 'lucide-react';
import type { Messages } from '@myelin/editor/i18n';
import { type Action, registry } from '@myelin/editor/keybinds';
import {
  getActionCategory,
  getActionCopy,
  getActionIcon,
} from '@myelin/editor/keybinds/messages';
import type { TabTarget } from '@/lib/tabs/types';
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
  openGraph: () => void;
  openPalette: (mode: CommandPaletteMode) => void;
  refreshRepository: () => void;
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
  openGraph,
  openPalette,
  refreshRepository,
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
      id: 'open-graph',
      label: strings.commandPalette.commands.openGraph.label,
      description: strings.commandPalette.commands.openGraph.description,
      keywords: ['graph', 'map', 'links', 'backlinks'],
      section: strings.commandPalette.sections.commands,
      icon: Network,
      onSelect: openGraph,
    },
    {
      id: 'import-markdown-library',
      label: strings.commandPalette.commands.importMarkdown.label,
      description: strings.commandPalette.commands.importMarkdown.description,
      keywords: ['markdown', 'md', 'file'],
      section: strings.commandPalette.sections.commands,
      icon: FileText,
      disabled: isImportingMarkdown,
      visibleOn: ['home'],
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
            visibleOn: ['home' as const],
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
  target: TabTarget | null,
): CommandPalettePage {
  if (!target) {
    return 'home';
  }
  switch (target.type) {
    case 'graph':
      return 'graph';
    case 'canvas':
      return 'canvas';
    case 'settings':
      return 'settings';
    case 'image':
    case 'csv':
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
