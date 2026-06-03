import { useCallback, useRef, useState } from 'react';

export interface MeasuredHeights {
  /** Latest measured height for a key, or undefined if not yet measured. */
  getHeight: (key: string) => number | undefined;
  /** Stable ref callback that measures and caches the element's height. */
  measure: (key: string) => (el: HTMLElement | null) => void;
  /** Bumped whenever a cached height changes; use as a memo dependency. */
  version: number;
  /** Drops cached heights and callbacks for keys no longer present. */
  prune: (liveKeys: Set<string>) => void;
}

/**
 * Caches measured element heights keyed by a stable string (e.g. a node id),
 * updating via a single shared ResizeObserver. Because the key is content-based
 * rather than positional, a measurement survives reordering and re-grouping —
 * the same item keeps its height without re-measuring when it moves.
 *
 * Height changes are coalesced into one `version` bump per microtask so a batch
 * of mounting rows triggers a single re-render.
 */
export function useMeasuredHeights(): MeasuredHeights {
  const heightsRef = useRef(new Map<string, number>());
  const [version, setVersion] = useState(0);

  const observerRef = useRef<ResizeObserver | null>(null);
  const elementKeyRef = useRef(new Map<Element, string>());
  const flushScheduledRef = useRef(false);
  const callbackCacheRef = useRef(
    new Map<string, (el: HTMLElement | null) => void>(),
  );

  const record = useCallback((key: string, el: HTMLElement) => {
    const height = Math.round(el.getBoundingClientRect().height);
    if (height <= 0 || heightsRef.current.get(key) === height) {
      return;
    }
    heightsRef.current.set(key, height);
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
    (key: string) => {
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

  const prune = useCallback((liveKeys: Set<string>) => {
    if (heightsRef.current.size > liveKeys.size) {
      for (const key of heightsRef.current.keys()) {
        if (!liveKeys.has(key)) {
          heightsRef.current.delete(key);
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

  return { getHeight, measure, version, prune };
}
