import { Undo2 } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import en from '@/lib/i18n/messages/en';
import { registry } from '@/lib/keybinds';
import {
  commandPalettePageFromTabTarget,
  createCommandPaletteItems,
} from './items';
import type { CommandPalettePage } from './types';

function commandIdsForPage(currentPage: CommandPalettePage): string[] {
  return createCommandPaletteItems({
    activeKeybindingActions: [],
    currentPage,
    strings: en,
    isImportingMarkdown: false,
    isRefreshingRepository: false,
    canRefreshRepository: false,
    createNote: async () => {},
    openGraph: () => {},
    openPalette: () => {},
    refreshRepository: async () => {},
    triggerKeybindingAction: () => {},
    triggerCanvasMarkdownImport: () => {},
    triggerLibraryMarkdownImport: () => {},
  }).map((item) => item.id);
}

describe('commandPalettePageFromTabTarget', () => {
  it('maps tab targets to command palette pages', () => {
    expect(commandPalettePageFromTabTarget(null)).toBe('home');
    expect(
      commandPalettePageFromTabTarget({ type: 'canvas', id: 'note-1' }),
    ).toBe('canvas');
    expect(commandPalettePageFromTabTarget({ type: 'graph' })).toBe('graph');
    expect(commandPalettePageFromTabTarget({ type: 'settings' })).toBe(
      'settings',
    );
    expect(
      commandPalettePageFromTabTarget({
        type: 'image',
        id: 'img-1',
        fileType: 'png',
      }),
    ).toBe('unknown');
  });
});

describe('createCommandPaletteItems', () => {
  it('keeps global commands available on every page', () => {
    expect(commandIdsForPage('settings')).toEqual([
      'open-note',
      'create-note',
      'open-graph',
    ]);
  });

  it('shows home commands only on the home page', () => {
    expect(commandIdsForPage('home')).toContain('import-markdown-library');
    expect(commandIdsForPage('canvas')).not.toContain(
      'import-markdown-library',
    );
  });

  it('shows repository refresh only for refreshable home repositories', () => {
    const items = createCommandPaletteItems({
      activeKeybindingActions: [],
      currentPage: 'home',
      strings: en,
      isImportingMarkdown: false,
      isRefreshingRepository: false,
      canRefreshRepository: true,
      createNote: async () => {},
      openGraph: () => {},
      openPalette: () => {},
      refreshRepository: async () => {},
      triggerKeybindingAction: () => {},
      triggerCanvasMarkdownImport: () => {},
      triggerLibraryMarkdownImport: () => {},
    });

    expect(items.map((item) => item.id)).toContain('refresh-repository');
    expect(commandIdsForPage('home')).not.toContain('refresh-repository');
  });

  it('shows canvas commands only on the canvas page', () => {
    expect(commandIdsForPage('canvas')).toContain('import-markdown-canvas');
    expect(commandIdsForPage('home')).not.toContain('import-markdown-canvas');
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
      isRefreshingRepository: false,
      canRefreshRepository: false,
      createNote: async () => {},
      openGraph: () => {},
      openPalette: () => {},
      refreshRepository: async () => {},
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

  it('opens graph from command items', () => {
    const opened: string[] = [];
    const items = createCommandPaletteItems({
      activeKeybindingActions: [],
      currentPage: 'home',
      strings: en,
      isImportingMarkdown: false,
      isRefreshingRepository: false,
      canRefreshRepository: false,
      createNote: async () => {},
      openGraph: () => opened.push('graph'),
      openPalette: () => {},
      refreshRepository: async () => {},
      triggerKeybindingAction: () => {},
      triggerCanvasMarkdownImport: () => {},
      triggerLibraryMarkdownImport: () => {},
    });

    items.find((item) => item.id === 'open-graph')?.onSelect();

    expect(opened).toEqual(['graph']);
  });
});
