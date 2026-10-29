import { useSyncExternalStore } from 'react';

export interface FlagsFilter {
  query: string;
  /** Empty shows every type. */
  typeIds: readonly string[];
}

// Module state, not component state: opening a flag unmounts the page.
let filter: FlagsFilter = { query: '', typeIds: [] };
const listeners = new Set<() => void>();

export function setFlagsFilter(changes: Partial<FlagsFilter>): void {
  filter = { ...filter, ...changes };
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useFlagsFilter(): FlagsFilter {
  return useSyncExternalStore(subscribe, () => filter);
}
