import {
  type HTMLAttributes,
  type ReactNode,
  type RefObject,
  useCallback,
  useLayoutEffect,
  useRef,
} from 'react';
import { cn } from '@/lib/utils';
import { useVirtualizer } from './use-virtualizer';

interface VirtualListProps {
  /** Scroll container the list lives inside (commonly an ancestor). */
  scrollRef: RefObject<HTMLElement | null>;
  /** Number of rows. */
  count: number;
  /** Height estimate for a row before it has been measured. */
  estimateHeight: (index: number) => number;
  /** Stable key per row. Measured heights are cached by this key. */
  getRowKey: (index: number) => string;
  /** Vertical gap between rows, in pixels. */
  gap: number;
  /** Rows to render beyond the viewport on each side. */
  overscan?: number;
  /** A row that must always render and be scrolled into view. */
  pinnedIndex?: number | null;
  /** Renders the contents of the row at `index`. */
  renderRow: (index: number) => ReactNode;
  /** Called with the container's content width whenever it changes. */
  onWidthChange?: (width: number) => void;
  className?: string;
  /** Extra props for the container element (e.g. drag-and-drop handlers). */
  containerProps?: HTMLAttributes<HTMLDivElement>;
}

/**
 * Reusable windowing list: renders only the rows that intersect the scroll
 * viewport (plus overscan), each absolutely positioned within a relative
 * container of the full content height. Row heights are measured as rows mount
 * and reflow automatically — see {@link useVirtualizer}.
 *
 * The list does not own a scrollbar; pass `scrollRef` to whichever ancestor
 * scrolls. Rows may be any height, so multi-column layouts work by having
 * `renderRow` lay out several items per row.
 */
export function VirtualList({
  scrollRef,
  count,
  estimateHeight,
  getRowKey,
  gap,
  overscan,
  pinnedIndex = null,
  renderRow,
  onWidthChange,
  className,
  containerProps,
}: VirtualListProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widthObserverRef = useRef<ResizeObserver | null>(null);
  const onWidthChangeRef = useRef(onWidthChange);
  onWidthChangeRef.current = onWidthChange;

  // Callback ref keeps the container element in sync and reports its width,
  // surviving the element un/remounting as the caller toggles surrounding
  // states (loading, empty, populated).
  const setContainerEl = useCallback((el: HTMLDivElement | null) => {
    widthObserverRef.current?.disconnect();
    containerRef.current = el;
    if (!el) {
      return;
    }
    onWidthChangeRef.current?.(el.clientWidth);
    const observer = new ResizeObserver(() =>
      onWidthChangeRef.current?.(el.clientWidth),
    );
    observer.observe(el);
    widthObserverRef.current = observer;
  }, []);

  const { totalHeight, virtualRows, measureRow, scrollToIndex } =
    useVirtualizer({
      scrollRef,
      containerRef,
      count,
      estimateHeight,
      getRowKey,
      gap,
      overscan,
      pinnedIndex,
    });

  useLayoutEffect(() => {
    if (pinnedIndex != null && pinnedIndex >= 0) {
      scrollToIndex(pinnedIndex);
    }
  }, [pinnedIndex, scrollToIndex]);

  return (
    <div
      ref={setContainerEl}
      {...containerProps}
      className={cn('relative', className)}
      style={{ height: totalHeight }}
    >
      {virtualRows.map((virtualRow) => (
        <div
          key={getRowKey(virtualRow.index)}
          ref={measureRow(virtualRow.index)}
          className="absolute inset-x-0"
          style={{ top: virtualRow.start }}
        >
          {renderRow(virtualRow.index)}
        </div>
      ))}
    </div>
  );
}
