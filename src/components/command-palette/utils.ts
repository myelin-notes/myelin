import { searchItems } from '@/lib/search';
import type { CommandPaletteEntry } from './types';

interface ScrollViewport {
  clientHeight: number;
  scrollTop: number;
}

interface ScrollItem {
  offsetHeight: number;
  offsetTop: number;
}

export function filterCommandPaletteEntries<T extends CommandPaletteEntry>(
  entries: T[],
  query: string,
): T[] {
  return searchItems(entries, query, {
    getId: (entry) => entry.id,
    fields: [
      { name: 'label', weight: 4, getValue: (entry) => entry.label },
      {
        name: 'keywords',
        weight: 3,
        getValue: (entry) => entry.keywords ?? [],
      },
      {
        name: 'description',
        weight: 1,
        getValue: (entry) => entry.description,
      },
    ],
  }).map((hit) => hit.item);
}

export function errorDescription(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function getScrollTopForVisibleItem(
  viewport: ScrollViewport,
  item: ScrollItem,
): number {
  const itemTop = item.offsetTop;
  const itemBottom = item.offsetTop + item.offsetHeight;
  const viewportTop = viewport.scrollTop;
  const viewportBottom = viewportTop + viewport.clientHeight;

  if (itemTop < viewportTop) {
    return itemTop;
  }
  if (itemBottom > viewportBottom) {
    return itemBottom - viewport.clientHeight;
  }
  return viewport.scrollTop;
}
