import type * as Y from 'yjs';
import { LOCAL_ORIGIN, type SyncOrigin } from './ydoc-manager';

/** Y.Map key → setter that updates the local cache, receiving the raw Y.Map value. */
export type YFieldMap = Record<string, (value: unknown) => void>;

// Does not subscribe to the Y.Map; callers decide when to apply changes.
export function applyYFields(
  yMap: Y.Map<unknown>,
  fields: YFieldMap,
  keys?: Iterable<string>,
): void {
  const entries = keys
    ? Array.from(keys, (key) => [key, fields[key]] as const)
    : Object.entries(fields);

  for (const [key, set] of entries) {
    if (!set) {
      continue;
    }
    const val = yMap.get(key);
    if (val !== undefined) {
      set(val);
    }
  }
}

export function writeYMap(
  yMap: Y.Map<unknown>,
  updates: Record<string, unknown>,
  origin: SyncOrigin = LOCAL_ORIGIN,
): void {
  yMap.doc!.transact(() => {
    for (const [key, value] of Object.entries(updates)) {
      yMap.set(key, value);
    }
  }, origin);
}
