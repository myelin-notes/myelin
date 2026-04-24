import type { CommandPaletteEntry } from './types';

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

export function filterCommandPaletteEntries<T extends CommandPaletteEntry>(
  entries: T[],
  query: string,
): T[] {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) {
    return entries;
  }

  const terms = normalizedQuery.split(/\s+/);
  return entries.filter((entry) => {
    const haystack = normalize(
      [entry.label, entry.description, ...(entry.keywords ?? [])].join(' '),
    );
    return terms.every((term) => haystack.includes(term));
  });
}

export function errorDescription(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
