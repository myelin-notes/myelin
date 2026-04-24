import { describe, expect, it } from 'vitest';
import { filterCommandPaletteEntries } from './utils';

const entries = [
  {
    id: 'create',
    label: 'Create note',
    description: 'Start a new canvas',
    keywords: ['new'],
  },
  {
    id: 'switch-view',
    label: 'Switch library view',
    description: 'Toggle list and grid',
    keywords: ['layout'],
  },
  {
    id: 'import',
    label: 'Import Markdown',
    description: 'Create a canvas from a file',
    keywords: ['md'],
  },
];

describe('filterCommandPaletteEntries', () => {
  it('returns all entries for an empty query', () => {
    expect(filterCommandPaletteEntries(entries, '')).toEqual(entries);
  });

  it('matches label, description, and keywords', () => {
    expect(filterCommandPaletteEntries(entries, 'layout')).toEqual([
      entries[1],
    ]);
    expect(filterCommandPaletteEntries(entries, 'file')).toEqual([entries[2]]);
    expect(filterCommandPaletteEntries(entries, 'create')).toEqual([
      entries[0],
      entries[2],
    ]);
  });

  it('requires every query term to match the same entry', () => {
    expect(filterCommandPaletteEntries(entries, 'create canvas')).toEqual([
      entries[0],
      entries[2],
    ]);
    expect(filterCommandPaletteEntries(entries, 'create grid')).toEqual([]);
  });
});
