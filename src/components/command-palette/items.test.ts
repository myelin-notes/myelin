import { describe, expect, it } from 'vitest';
import en from '@/lib/i18n/messages/en';
import {
  commandPalettePageFromPathname,
  createCommandPaletteItems,
} from './items';
import type { CommandPalettePage } from './types';

function commandIdsForPage(currentPage: CommandPalettePage): string[] {
  return createCommandPaletteItems({
    currentPage,
    strings: en,
    isImportingMarkdown: false,
    createNote: async () => {},
    openPalette: () => {},
    toggleLibraryView: () => {},
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
    expect(commandPalettePageFromPathname('/debug')).toBe('debug');
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
    expect(commandIdsForPage('canvas')).toContain('insert-note-link');
    expect(commandIdsForPage('library')).not.toContain(
      'import-markdown-canvas',
    );
    expect(commandIdsForPage('library')).not.toContain('insert-note-link');
  });
});
