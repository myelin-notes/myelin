import { describe, expect, it } from 'vitest';
import {
  filterCommandPaletteEntries,
  getScrollTopForVisibleItem,
  shouldActivatePointerSelection,
} from './utils';

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

  it('supports fuzzy command matching', () => {
    expect(filterCommandPaletteEntries(entries, 'layot')).toEqual([entries[1]]);
  });
});

describe('getScrollTopForVisibleItem', () => {
  it('keeps the current scroll position when the item is already visible', () => {
    expect(
      getScrollTopForVisibleItem(
        { clientHeight: 200, scrollTop: 100 },
        { offsetHeight: 40, offsetTop: 180 },
      ),
    ).toBe(100);
  });

  it('scrolls up when the item is above the viewport', () => {
    expect(
      getScrollTopForVisibleItem(
        { clientHeight: 200, scrollTop: 100 },
        { offsetHeight: 40, offsetTop: 60 },
      ),
    ).toBe(60);
  });

  it('scrolls down when the item is below the viewport', () => {
    expect(
      getScrollTopForVisibleItem(
        { clientHeight: 200, scrollTop: 100 },
        { offsetHeight: 40, offsetTop: 320 },
      ),
    ).toBe(160);
  });

  it('uses viewport-relative bounds when offsetTop is not relative to the scroller', () => {
    expect(
      getScrollTopForVisibleItem(
        {
          clientHeight: 200,
          scrollTop: 80,
          getBoundingClientRect: () => ({ top: 300 }),
        },
        {
          offsetHeight: 58,
          offsetTop: 166,
          getBoundingClientRect: () => ({ top: 280, bottom: 338 }),
        },
      ),
    ).toBe(60);
  });
});

describe('shouldActivatePointerSelection', () => {
  it('ignores the first stationary event after keyboard navigation suspends hover', () => {
    expect(
      shouldActivatePointerSelection(
        null,
        { clientX: 120, clientY: 240 },
        true,
      ),
    ).toBe(false);
  });

  it('ignores pointer events when the cursor coordinates did not change', () => {
    expect(
      shouldActivatePointerSelection(
        { clientX: 120, clientY: 240 },
        { clientX: 120, clientY: 240 },
        false,
      ),
    ).toBe(false);
  });

  it('reactivates hover when the pointer actually moves', () => {
    expect(
      shouldActivatePointerSelection(
        { clientX: 120, clientY: 240 },
        { clientX: 121, clientY: 240 },
        true,
      ),
    ).toBe(true);
  });
});
