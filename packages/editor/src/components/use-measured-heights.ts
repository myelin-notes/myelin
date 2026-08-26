import { useCallback, useRef, useState } from 'react';

export interface MeasuredHeights {
  /** Latest measured height for a key, or undefined if not yet measured. */
  getHeight: (key: string) => number | undefined;
  /** Stable ref callback that measures and caches the element's height. The
   *  row `index` lets the cache report which positions changed. */
  measure: (key: string, index: number) => (el: HTMLElement | null) => void;
  /** Bumped whenever a cached height changes; use as a memo dependency. */
  version: number;
  /** Lowest row index whose height changed since the last call, then resets to Infinity. */
  consumeDirtyFrom: () => number;
  /** Drops cached heights and callbacks for keys no longer present. */
  prune: (liveKeys: Set<string>) => void;
}

/**
 * Caches measured element heights keyed by a stable string (e.g. a node id) via one shared
 * ResizeObserver. The key is content-based, not positional, so a measurement survives reordering
 * and re-grouping. Changes are coalesced into one `version` bump per microtask.
 *
 * `estimateHeight` is the height the layout assumes before measurement. A first measurement equal
 * to the estimate changes nothing on screen, so the version bump is skipped — that is what keeps
 * scrolling through uniform-height content from rebuilding offsets for every newly-mounted row.
 */
export function useMeasuredHeights(
  estimateHeight?: (index: number) => number,
): MeasuredHeights {
  const heightsRef = useRef(new Map<string, number>());
  const [version, setVersion] = useState(0);

  const estimateRef = useRef(estimateHeight);
  estimateRef.current = estimateHeight;
  const observerRef = useRef<ResizeObserver | null>(null);
  const elementKeyRef = useRef(new Map<Element, string>());
  const keyIndexRef = useRef(new Map<string, number>());
  const dirtyFromRef = useRef(Number.POSITIVE_INFINITY);
  const flushScheduledRef = useRef(false);
  const callbackCacheRef = useRef(
    new Map<string, (el: HTMLElement | null) => void>(),
  );

  const record = useCallback((key: string, el: HTMLElement) => {
    const height = Math.round(el.getBoundingClientRect().height);
    const prev = heightsRef.current.get(key);
    if (height <= 0 || prev === height) {
      return;
    }
    const index = keyIndexRef.current.get(key);
    // If the exact height matches, store it for future reads but don't invalidate layout.
    const assumed =
      prev ?? (index !== undefined ? estimateRef.current?.(index) : undefined);
    heightsRef.current.set(key, height);
    if (assumed !== undefined && height === assumed) {
      return;
    }
    if (index !== undefined && index < dirtyFromRef.current) {
      dirtyFromRef.current = index;
    }
    if (!flushScheduledRef.current) {
      flushScheduledRef.current = true;
      queueMicrotask(() => {
        flushScheduledRef.current = false;
        setVersion((v) => v + 1);
      });
    }
  }, []);

  const getObserver = useCallback(() => {
    if (!observerRef.current) {
      observerRef.current = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const key = elementKeyRef.current.get(entry.target);
          if (key !== undefined) {
            record(key, entry.target as HTMLElement);
          }
        }
      });
    }
    return observerRef.current;
  }, [record]);

  // One stable callback per key so elements aren't re-observed every render.
  const measure = useCallback(
    (key: string, index: number) => {
      // Track each key's current row index so `record` can report the lowest
      // changed position. Updated every render since a key can move (grids).
      keyIndexRef.current.set(key, index);
      const cache = callbackCacheRef.current;
      let cb = cache.get(key);
      if (!cb) {
        cb = (el: HTMLElement | null) => {
          if (!el) {
            return;
          }
          const observer = getObserver();
          elementKeyRef.current.set(el, key);
          observer.observe(el);
          record(key, el);
          return () => {
            observer.unobserve(el);
            elementKeyRef.current.delete(el);
          };
        };
        cache.set(key, cb);
      }
      return cb;
    },
    [getObserver, record],
  );

  const getHeight = useCallback(
    (key: string) => heightsRef.current.get(key),
    [],
  );

  const consumeDirtyFrom = useCallback(() => {
    const from = dirtyFromRef.current;
    dirtyFromRef.current = Number.POSITIVE_INFINITY;
    return from;
  }, []);

  const prune = useCallback((liveKeys: Set<string>) => {
    if (heightsRef.current.size > liveKeys.size) {
      for (const key of heightsRef.current.keys()) {
        if (!liveKeys.has(key)) {
          heightsRef.current.delete(key);
          keyIndexRef.current.delete(key);
        }
      }
    }
    if (callbackCacheRef.current.size > liveKeys.size) {
      for (const key of callbackCacheRef.current.keys()) {
        if (!liveKeys.has(key)) {
          callbackCacheRef.current.delete(key);
        }
      }
    }
  }, []);

  return { getHeight, measure, version, consumeDirtyFrom, prune };
}
