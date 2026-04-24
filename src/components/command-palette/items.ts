import { BookOpen, FileText, Grid2X2, Link, Plus } from 'lucide-react';
import type { Messages } from '@/lib/i18n';
import { registry } from '@/lib/keybinds';
import type { CommandPaletteItem, CommandPaletteMode } from './types';

export interface CommandPaletteItemContext {
  strings: Messages;
  isImportingMarkdown: boolean;
  createNote: () => Promise<void>;
  openPalette: (mode: CommandPaletteMode) => void;
  toggleLibraryView: () => void;
  triggerMarkdownImport: () => void;
}

export function createCommandPaletteItems({
  strings,
  isImportingMarkdown,
  createNote,
  openPalette,
  toggleLibraryView,
  triggerMarkdownImport,
}: CommandPaletteItemContext): CommandPaletteItem[] {
  return [
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
      id: 'import-markdown',
      label: strings.commandPalette.commands.importMarkdown.label,
      description: strings.commandPalette.commands.importMarkdown.description,
      keywords: ['markdown', 'md', 'file'],
      section: strings.commandPalette.sections.commands,
      icon: FileText,
      disabled: isImportingMarkdown,
      onSelect: triggerMarkdownImport,
    },
    {
      id: 'switch-library-view',
      label: strings.commandPalette.commands.switchView.label,
      description: strings.commandPalette.commands.switchView.description,
      keywords: ['grid', 'list', 'tree'],
      section: strings.commandPalette.sections.commands,
      icon: Grid2X2,
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
      onSelect: () => {},
    },
  ];
}

export function commandPaletteShortcut(): string {
  return registry.format('app:command-palette');
}
