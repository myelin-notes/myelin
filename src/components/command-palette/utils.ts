import { searchItems } from '@/lib/search';
import type { CommandPaletteEntry } from './types';

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
