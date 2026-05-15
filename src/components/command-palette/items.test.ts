import { Undo2 } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import en from '@/lib/i18n/messages/en';
import { registry } from '@/lib/keybinds';
import {
  commandPalettePageFromPathname,
  createCommandPaletteItems,
} from './items';
import type { CommandPalettePage } from './types';

function commandIdsForPage(currentPage: CommandPalettePage): string[] {
  return createCommandPaletteItems({
    activeKeybindingActions: [],
    currentPage,
    strings: en,
    isImportingMarkdown: false,
    createNote: async () => {},
    openPalette: () => {},
    toggleLibraryView: () => {},
    triggerKeybindingAction: () => {},
    triggerCanvasMarkdownImport: () => {},
    triggerLibraryMarkdownImport: () => {},
  }).map((item) => item.id);
}

describe('commandPalettePageFromPathname', () => {
  it('maps app routes to command palette pages', () => {
    expect(commandPalettePageFromPathname('/')).toBe('library');
    expect(commandPalettePageFromPathname('/library')).toBe('library');
    expect(commandPalettePageFromPathname('/mcanvas/note-1')).toBe('canvas');
    expect(commandPalettePageFromPathname('/settings')).toBe('settings');
    expect(commandPalettePageFromPathname('/missing')).toBe('unknown');
  });
});

describe('createCommandPaletteItems', () => {
  it('keeps global commands available on every page', () => {
    expect(commandIdsForPage('settings')).toEqual(['open-note', 'create-note']);
  });

  it('shows library commands only on the library page', () => {
    expect(commandIdsForPage('library')).toContain('import-markdown-library');
    expect(commandIdsForPage('library')).toContain('switch-library-view');
    expect(commandIdsForPage('canvas')).not.toContain(
      'import-markdown-library',
    );
    expect(commandIdsForPage('canvas')).not.toContain('switch-library-view');
  });

  it('shows canvas commands only on the canvas page', () => {
    expect(commandIdsForPage('canvas')).toContain('import-markdown-canvas');
    expect(commandIdsForPage('library')).not.toContain(
      'import-markdown-canvas',
    );
  });

  it('adds live keybinding actions as runnable command items', () => {
    const triggered: string[] = [];
    const items = createCommandPaletteItems({
      activeKeybindingActions: [
        'app:command-palette',
        'canvas:undo',
        'canvas:tool-pen',
      ],
      currentPage: 'canvas',
      strings: en,
      isImportingMarkdown: false,
      createNote: async () => {},
      openPalette: () => {},
      toggleLibraryView: () => {},
      triggerKeybindingAction: (action) => triggered.push(action),
      triggerCanvasMarkdownImport: () => {},
      triggerLibraryMarkdownImport: () => {},
    });

    expect(items.map((item) => item.id)).toContain('action:canvas:undo');
    expect(items.map((item) => item.id)).toContain('action:canvas:tool-pen');
    expect(items.map((item) => item.id)).not.toContain(
      'action:app:command-palette',
    );
    expect(
      items.find((item) => item.id === 'action:canvas:undo')?.shortcut,
    ).toBe(registry.format('canvas:undo'));
    expect(items.find((item) => item.id === 'action:canvas:undo')?.icon).toBe(
      Undo2,
    );

    items.find((item) => item.id === 'action:canvas:undo')?.onSelect();
    expect(triggered).toEqual(['canvas:undo']);
  });
});
