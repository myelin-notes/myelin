import type * as Y from 'yjs';
import { LOCAL_ORIGIN, type SyncOrigin } from './ydoc-manager';

/**
 * Field mapping: Y.Map key → setter that updates the local cache.
 * Each setter receives the raw value from the Y.Map.
 */
export type YFieldMap = Record<string, (value: unknown) => void>;

/**
 * Read fields from a Y.Map into element-local state.
 * This does not subscribe to the Y.Map; callers decide when to apply changes.
 */
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

/**
 * Write one or more key-value pairs to a Y.Map in a single local transaction.
 */
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
