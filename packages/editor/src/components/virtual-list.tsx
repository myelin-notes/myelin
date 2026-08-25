import {
  type HTMLAttributes,
  type ReactNode,
  type RefObject,
  useCallback,
  useLayoutEffect,
} from 'react';
import {
  mergeContainerProps,
  useVirtualScaffold,
} from './use-virtual-scaffold';
import { useVirtualizer } from './use-virtualizer';

interface VirtualListProps {
  /** Scroll container the list lives inside (commonly an ancestor). */
  scrollRef: RefObject<HTMLElement | null>;
  count: number;
  /** Height estimate for a row before it has been measured. */
  estimateHeight: (index: number) => number;
  /** Stable key per row. Measured heights are cached by this key, so they
   *  survive reordering as long as the key follows the content. */
  getRowKey: (index: number) => string;
  /** Vertical gap between rows, in pixels. */
  gap: number;
  /** Rows to render beyond the viewport on each side. */
  overscan?: number;
  /** A row that must always render and be scrolled into view. */
  pinnedIndex?: number | null;
  renderRow: (index: number) => ReactNode;
  /** Called with the container's content width whenever it changes. */
  onWidthChange?: (width: number) => void;
  className?: string;
  /** Extra props for the container element (e.g. drag-and-drop handlers). */
  containerProps?: HTMLAttributes<HTMLDivElement>;
}

/**
 * Single-column windowing list. Does not own a scrollbar — pass `scrollRef` to whichever ancestor
 * scrolls. For multi-column layouts that must preserve item identity across reordering, use
 * VirtualGrid instead.
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
  const { containerRef, setContainerEl, measured } = useVirtualScaffold(
    count,
    getRowKey,
    estimateHeight,
    onWidthChange,
  );

  const rowHeight = useCallback(
    (index: number) =>
      measured.getHeight(getRowKey(index)) ?? estimateHeight(index),
    [measured, getRowKey, estimateHeight],
  );

  const { totalHeight, virtualRows, scrollToIndex } = useVirtualizer({
    scrollRef,
    containerRef,
    count,
    rowHeight,
    heightsVersion: measured.version,
    consumeDirtyFrom: measured.consumeDirtyFrom,
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
      {...mergeContainerProps(containerProps, className, totalHeight)}
    >
      {virtualRows.map((virtualRow) => {
        const key = getRowKey(virtualRow.index);
        return (
          <div
            key={key}
            ref={measured.measure(key, virtualRow.index)}
            className="absolute inset-x-0"
            style={{ top: virtualRow.start }}
          >
            {renderRow(virtualRow.index)}
          </div>
        );
      })}
    </div>
  );
}
