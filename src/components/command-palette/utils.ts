import { createSearchIndex, type SearchIndex } from '@/lib/search';
import type { CommandPaletteEntry } from './types';

interface ScrollViewport {
  clientHeight: number;
  scrollTop: number;
  getBoundingClientRect?: () => Pick<DOMRect, 'top'>;
}

interface ScrollItem {
  offsetHeight: number;
  offsetTop: number;
  getBoundingClientRect?: () => Pick<DOMRect, 'top' | 'bottom'>;
}

export interface PointerPosition {
  clientX: number;
  clientY: number;
}

/**
 * Build a reusable search index over command entries. Callers that filter the
 * same entries across many queries (e.g. per keystroke) should build this once
 * and reuse it rather than rebuilding the MiniSearch index on every query.
 */
export function createCommandPaletteSearchIndex<T extends CommandPaletteEntry>(
  entries: T[],
): SearchIndex<T> {
  return createSearchIndex({
    items: entries,
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
  });
}

export function filterCommandPaletteEntries<T extends CommandPaletteEntry>(
  entries: T[],
  query: string,
): T[] {
  return createCommandPaletteSearchIndex(entries)
    .search(query)
    .map((hit) => hit.item);
}

export function errorDescription(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function getScrollTopForVisibleItem(
  viewport: ScrollViewport,
  item: ScrollItem,
): number {
  const itemTop =
    viewport.getBoundingClientRect && item.getBoundingClientRect
      ? item.getBoundingClientRect().top -
        viewport.getBoundingClientRect().top +
        viewport.scrollTop
      : item.offsetTop;
  const itemBottom = itemTop + item.offsetHeight;
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

export function shouldActivatePointerSelection(
  previous: PointerPosition | null,
  next: PointerPosition,
  suspended: boolean,
): boolean {
  if (previous === null) {
    return !suspended;
  }
  return previous.clientX !== next.clientX || previous.clientY !== next.clientY;
}
