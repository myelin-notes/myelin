import { BookOpen, FileText, Grid2X2, Link, Plus } from 'lucide-react';
import type { Messages } from '@/lib/i18n';
import { registry } from '@/lib/keybinds';
import type {
  CommandPaletteItem,
  CommandPaletteMode,
  CommandPalettePage,
} from './types';

export interface CommandPaletteItemContext {
  currentPage: CommandPalettePage;
  strings: Messages;
  isImportingMarkdown: boolean;
  createNote: () => Promise<void>;
  openPalette: (mode: CommandPaletteMode) => void;
  toggleLibraryView: () => void;
  triggerCanvasMarkdownImport: () => void;
  triggerLibraryMarkdownImport: () => void;
}

export function createCommandPaletteItems({
  currentPage,
  strings,
  isImportingMarkdown,
  createNote,
  openPalette,
  toggleLibraryView,
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
  if (isRoute(pathname, '/debug')) {
    return 'debug';
  }
  return 'unknown';
}

function isCommandPaletteItemVisible(
  item: CommandPaletteItem,
  currentPage: CommandPalettePage,
): boolean {
  return !item.visibleOn || item.visibleOn.includes(currentPage);
}

function isRoute(pathname: string, route: string): boolean {
  return pathname === route || pathname.startsWith(`${route}/`);
}
