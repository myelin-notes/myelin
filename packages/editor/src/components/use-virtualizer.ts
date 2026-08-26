import {
  type RefObject,
  useCallback,
  useEffect,
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
  count: number;
  /** Resolved height of a row, in pixels (measured or estimated). */
  rowHeight: (index: number) => number;
  /** Bumped whenever a `rowHeight` result changes; retriggers layout. */
  heightsVersion: number;
  /** Returns the lowest row index whose height changed since the last call (or
   *  Infinity). Lets offsets rebuild from that index instead of from scratch. */
  consumeDirtyFrom: () => number;
  /** Bump when `rowHeight`'s index→height mapping changes wholesale (e.g. a grid's column count),
   *  forcing a full offsets rebuild. */
  layoutKey?: unknown;
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
 * Windowing core: resolves which rows intersect the scroll viewport (plus overscan) and where
 * each sits. Holds no measurement logic — callers supply `rowHeight` and bump `heightsVersion`
 * (see {@link useMeasuredHeights}). The scroll container may be any ancestor; the list's offset
 * within it is derived from live bounding rects.
 */
export function useVirtualizer({
  scrollRef,
  containerRef,
  count,
  rowHeight,
  heightsVersion,
  consumeDirtyFrom,
  layoutKey,
  gap,
  overscan = 4,
  pinnedIndex = null,
}: UseVirtualizerOptions): UseVirtualizerResult {
  const rowHeightRef = useRef(rowHeight);
  rowHeightRef.current = rowHeight;
  const offsetsRef = useRef<number[]>([]);
  const builtCountRef = useRef(0);
  const builtGapRef = useRef(gap);
  const builtLayoutKeyRef = useRef(layoutKey);
  const [range, setRange] = useState({ start: 0, end: 0 });

  // Offsets are a prefix sum. Rebuilding the whole array per append/measurement is O(count) every
  // frame, so rebuild only from the lowest changed index. The array is mutated in place —
  // `heightsVersion` is the signal that its values changed.
  // biome-ignore lint/correctness/useExhaustiveDependencies: heightsVersion retriggers this after heights change; consumeDirtyFrom is read, not depended on
  const { offsets, totalHeight } = useMemo(() => {
    const arr = offsetsRef.current;
    let dirtyFrom = Math.min(consumeDirtyFrom(), builtCountRef.current);
    if (
      gap !== builtGapRef.current ||
      layoutKey !== builtLayoutKeyRef.current
    ) {
      dirtyFrom = 0;
    }
    dirtyFrom = Math.max(0, Math.min(dirtyFrom, count));

    arr.length = count;
    let y =
      dirtyFrom > 0
        ? arr[dirtyFrom - 1] + rowHeightRef.current(dirtyFrom - 1) + gap
        : 0;
    for (let i = dirtyFrom; i < count; i++) {
      arr[i] = y;
      y += rowHeightRef.current(i) + gap;
    }

    builtCountRef.current = count;
    builtGapRef.current = gap;
    builtLayoutKeyRef.current = layoutKey;
    return { offsets: arr, totalHeight: count > 0 ? y - gap : 0 };
  }, [count, gap, layoutKey, heightsVersion]);

  // `offsets` is mutated in place, so its identity is stable.
  // biome-ignore lint/correctness/useExhaustiveDependencies: heightsVersion stands in for offsets' mutated contents
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
  }, [
    scrollRef,
    containerRef,
    count,
    offsets,
    heightsVersion,
    overscan,
    pinnedIndex,
  ]);

  // Subscribe once; read the latest recompute via a ref instead of re-subscribing on layout change.
  // Must be a passive effect, not a layout effect: when the scroll frame is an ancestor mounting in
  // the same commit, React attaches refs child-first, so `scrollRef.current` is still null during
  // layout effects and the subscription would silently never attach.
  const recomputeRef = useRef(recomputeRange);
  recomputeRef.current = recomputeRange;
  useEffect(() => {
    const frame = scrollRef.current;
    if (!frame) {
      return;
    }
    // Sync now in case the frame only became available after the pre-paint
    // recompute below ran with a null ref.
    recomputeRef.current();
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

  // Also fires right after the container first mounts and after rows are measured, both before
  // paint to avoid a flash.
  useLayoutEffect(() => {
    recomputeRange();
  }, [recomputeRange]);

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

  // biome-ignore lint/correctness/useExhaustiveDependencies: heightsVersion signals offsets' values changed
  const virtualRows = useMemo(() => {
    // `range` is updated in an effect after render, so it can briefly lag a shrunk `count`.
    const rows: VirtualRow[] = [];
    const start = Math.min(range.start, count);
    const end = Math.min(range.end, count);
    for (let i = start; i < end; i++) {
      rows.push({ index: i, start: offsets[i] ?? 0 });
    }
    return rows;
  }, [range, offsets, count, heightsVersion]);

  return { totalHeight, virtualRows, scrollToIndex };
}
