import {
  type RefObject,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

export interface VirtualRow {
  index: number;
  /** Top offset of the row within the list content, in pixels. */
  start: number;
}

interface UseVirtualizerOptions {
  /** The scroll container the list lives inside (usually an ancestor). */
  scrollRef: RefObject<HTMLElement | null>;
  /** The sized, `position: relative` element that wraps the rows. */
  containerRef: RefObject<HTMLElement | null>;
  /** Number of rows. */
  count: number;
  /** Height estimate for a row before it has been measured. */
  estimateHeight: (index: number) => number;
  /** Stable key per row. Measured heights are cached by this key, so they
   *  survive sorting and re-grouping as long as the key is stable. */
  getRowKey: (index: number) => string;
  /** Vertical gap between rows, in pixels. */
  gap: number;
  /** Rows to render beyond the viewport on each side. */
  overscan?: number;
  /** A row that must always be rendered (e.g. an item being renamed). */
  pinnedIndex?: number | null;
}

interface UseVirtualizerResult {
  totalHeight: number;
  virtualRows: VirtualRow[];
  /** Ref callback for a rendered row; measures and caches its height. */
  measureRow: (index: number) => (el: HTMLElement | null) => void;
  /** Scrolls the frame so the row at `index` is brought into view. */
  scrollToIndex: (index: number) => void;
}

/** Largest index whose offset is `<= target`. Assumes ascending offsets. */
function findRowAt(offsets: number[], target: number): number {
  let lo = 0;
  let hi = offsets.length - 1;
  let ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (offsets[mid] <= target) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

/**
 * Minimal windowing virtualizer. Renders only the rows that intersect the
 * scroll viewport (plus overscan), positioning each absolutely within a
 * relative container of the full content height.
 *
 * Row heights start from `estimateHeight` and are corrected as rows mount via
 * a shared ResizeObserver, so variable-height rows reflow without a separate
 * measurement pass. The scroll container may be any ancestor — the list's
 * offset within it is derived from live bounding rects, so unrelated content
 * above the list (headers, etc.) is accounted for automatically.
 */
export function useVirtualizer({
  scrollRef,
  containerRef,
  count,
  estimateHeight,
  getRowKey,
  gap,
  overscan = 4,
  pinnedIndex = null,
}: UseVirtualizerOptions): UseVirtualizerResult {
  // Latest non-stable inputs, read inside callbacks/observers without making
  // them dependencies.
  const estimateRef = useRef(estimateHeight);
  estimateRef.current = estimateHeight;
  const keyRef = useRef(getRowKey);
  keyRef.current = getRowKey;

  const heightsRef = useRef(new Map<string, number>());
  const offsetsRef = useRef<number[]>([]);
  const [measureTick, setMeasureTick] = useState(0);
  const [range, setRange] = useState({ start: 0, end: 0 });

  // Recompute offsets whenever the row set or a measurement changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: measureTick intentionally retriggers this after heights are recorded
  const { offsets, totalHeight } = useMemo(() => {
    const next: number[] = new Array(count);
    let y = 0;
    for (let i = 0; i < count; i++) {
      next[i] = y;
      const h =
        heightsRef.current.get(keyRef.current(i)) ?? estimateRef.current(i);
      y += h + gap;
    }
    offsetsRef.current = next;
    return { offsets: next, totalHeight: count > 0 ? y - gap : 0 };
  }, [count, gap, measureTick]);

  const recomputeRange = useCallback(() => {
    const frame = scrollRef.current;
    const container = containerRef.current;
    if (!frame || !container || count === 0) {
      return;
    }
    const frameRect = frame.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    // How far the list's top sits above the frame's top edge.
    const scrolledPast = Math.max(0, frameRect.top - containerRect.top);
    const viewport = frame.clientHeight;

    let start = findRowAt(offsets, scrolledPast);
    let end = Math.min(count, findRowAt(offsets, scrolledPast + viewport) + 1);
    start = Math.max(0, start - overscan);
    end = Math.min(count, end + overscan);

    if (pinnedIndex != null && pinnedIndex >= 0 && pinnedIndex < count) {
      start = Math.min(start, pinnedIndex);
      end = Math.max(end, pinnedIndex + 1);
    }

    setRange((prev) =>
      prev.start === start && prev.end === end ? prev : { start, end },
    );
  }, [scrollRef, containerRef, count, offsets, overscan, pinnedIndex]);

  // Subscribe once to scroll and viewport resize. The frame is a stable
  // ancestor, so we read the latest recompute via a ref instead of
  // re-subscribing whenever the layout changes.
  const recomputeRef = useRef(recomputeRange);
  recomputeRef.current = recomputeRange;
  useLayoutEffect(() => {
    const frame = scrollRef.current;
    if (!frame) {
      return;
    }
    let raf = 0;
    const onScroll = () => {
      if (raf) {
        return;
      }
      raf = requestAnimationFrame(() => {
        raf = 0;
        recomputeRef.current();
      });
    };
    frame.addEventListener('scroll', onScroll, { passive: true });

    const resizeObserver = new ResizeObserver(() => recomputeRef.current());
    resizeObserver.observe(frame);

    return () => {
      frame.removeEventListener('scroll', onScroll);
      resizeObserver.disconnect();
      if (raf) {
        cancelAnimationFrame(raf);
      }
    };
  }, [scrollRef]);

  // Recompute the window whenever the layout or inputs change. This also fires
  // right after the container first mounts (offsets/count change then) and
  // after rows are measured, all before paint to avoid a flash.
  useLayoutEffect(() => {
    recomputeRange();
  }, [recomputeRange]);

  // Shared observer + per-row measurement, batched into one re-render.
  const rowObserverRef = useRef<ResizeObserver | null>(null);
  const elementIndexRef = useRef(new Map<Element, number>());
  const flushScheduledRef = useRef(false);

  const recordHeight = useCallback((index: number, el: HTMLElement) => {
    const key = keyRef.current(index);
    const height = Math.round(el.getBoundingClientRect().height);
    if (height <= 0 || heightsRef.current.get(key) === height) {
      return;
    }
    heightsRef.current.set(key, height);
    if (!flushScheduledRef.current) {
      flushScheduledRef.current = true;
      queueMicrotask(() => {
        flushScheduledRef.current = false;
        setMeasureTick((t) => t + 1);
      });
    }
  }, []);

  const getRowObserver = useCallback(() => {
    if (!rowObserverRef.current) {
      rowObserverRef.current = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const index = elementIndexRef.current.get(entry.target);
          if (index !== undefined) {
            recordHeight(index, entry.target as HTMLElement);
          }
        }
      });
    }
    return rowObserverRef.current;
  }, [recordHeight]);

  // Stable ref callback per index so rows aren't re-observed on every render.
  const callbackCacheRef = useRef(
    new Map<number, (el: HTMLElement | null) => void>(),
  );
  const measureRow = useCallback(
    (index: number) => {
      const cache = callbackCacheRef.current;
      let cb = cache.get(index);
      if (!cb) {
        cb = (el: HTMLElement | null) => {
          if (!el) {
            return;
          }
          const observer = getRowObserver();
          elementIndexRef.current.set(el, index);
          observer.observe(el);
          recordHeight(index, el);
          return () => {
            observer.unobserve(el);
            elementIndexRef.current.delete(el);
          };
        };
        cache.set(index, cb);
      }
      return cb;
    },
    [getRowObserver, recordHeight],
  );

  const scrollToIndex = useCallback(
    (index: number) => {
      const frame = scrollRef.current;
      const container = containerRef.current;
      if (!frame || !container || index < 0) {
        return;
      }
      const frameRect = frame.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const containerTopInContent =
        frame.scrollTop + (containerRect.top - frameRect.top);
      const target = containerTopInContent + (offsetsRef.current[index] ?? 0);
      frame.scrollTo({ top: Math.max(0, target - 24), behavior: 'smooth' });
    },
    [scrollRef, containerRef],
  );

  const virtualRows = useMemo(() => {
    const rows: VirtualRow[] = [];
    for (let i = range.start; i < range.end; i++) {
      rows.push({ index: i, start: offsets[i] ?? 0 });
    }
    return rows;
  }, [range, offsets]);

  return { totalHeight, virtualRows, measureRow, scrollToIndex };
}
