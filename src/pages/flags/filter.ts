import { useSyncExternalStore } from 'react';
import type { VFSNodeId } from '@/lib/sync';

export interface FlagsFilter {
  /** `null` lists the whole repository. */
  folder: { id: VFSNodeId; name: string } | null;
  query: string;
  /** Empty shows every type. */
  typeIds: readonly string[];
}

// Module state, not component state: opening a flag unmounts the page, and the folder menu sets
// the scope before the page exists.
let filter: FlagsFilter = { folder: null, query: '', typeIds: [] };
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
