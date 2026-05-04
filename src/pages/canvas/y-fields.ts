import type * as Y from 'yjs';
import { LOCAL_ORIGIN } from './ydoc-manager';

/**
 * Field mapping: Y.Map key → setter that updates the local cache.
 * Each setter receives the raw value from the Y.Map.
 */
export type YFieldMap = Record<string, (value: unknown) => void>;

/**
 * Bind a Y.Map to element fields in one call:
 * 1. Reads initial values from the Y.Map into the element via setters
 * 2. Registers a single observer that dispatches remote changes to setters
 *
 * Call once per element class level (base + subclass each call with their fields).
 */
export function bindYFields(
  yMap: Y.Map<unknown>,
  fields: YFieldMap,
): () => void {
  for (const [key, set] of Object.entries(fields)) {
    const val = yMap.get(key);
    if (val !== undefined) {
      set(val);
    }
  }

  const observer = (event: Y.YMapEvent<unknown>) => {
    if (event.transaction.origin === LOCAL_ORIGIN) {
      return;
    }
    for (const key of event.keysChanged) {
      const set = fields[key];
      if (set) {
        const val = yMap.get(key);
        if (val !== undefined) {
          set(val);
        }
      }
    }
  };
  yMap.observe(observer);

  return () => {
    yMap.unobserve(observer);
  };
}

/**
 * Write one or more key-value pairs to a Y.Map in a single local transaction.
 */
export function writeYMap(
  yMap: Y.Map<unknown>,
  updates: Record<string, unknown>,
): void {
  yMap.doc!.transact(() => {
    for (const [key, value] of Object.entries(updates)) {
      yMap.set(key, value);
    }
  }, LOCAL_ORIGIN);
}
