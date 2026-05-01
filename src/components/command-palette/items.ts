import {
  BookOpen,
  FileText,
  Grid2X2,
  Keyboard,
  Link,
  Plus,
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
  createNote: () => Promise<void>;
  openPalette: (mode: CommandPaletteMode) => void;
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
  createNote,
  openPalette,
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
    {
      id: 'insert-note-link',
      label: strings.commandPalette.commands.insertLink.label,
      description: strings.commandPalette.commands.insertLink.description,
      keywords: ['link', 'embed', 'backlink'],
      section: strings.commandPalette.sections.commands,
      icon: Link,
      disabled: true,
      visibleOn: ['canvas'],
      onSelect: () => {},
    },
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

export function commandPalettePageFromPathname(
  pathname: string,
): CommandPalettePage {
  if (pathname === '/' || isRoute(pathname, '/library')) {
    return 'library';
  }
  if (isRoute(pathname, '/mcanvas')) {
    return 'canvas';
  }
  if (isRoute(pathname, '/settings')) {
    return 'settings';
  }
  return 'unknown';
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

function isRoute(pathname: string, route: string): boolean {
  return pathname === route || pathname.startsWith(`${route}/`);
}
