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
} from '@myelin/editor/components/use-virtual-scaffold';
import { useVirtualizer } from '@myelin/editor/components/use-virtualizer';

interface VirtualGridProps {
  /** Scroll container the grid lives inside (commonly an ancestor). */
  scrollRef: RefObject<HTMLElement | null>;
  itemCount: number;
  /** Number of columns. Items flow left-to-right, top-to-bottom. */
  columns: number;
  /** Width of a single cell, in pixels. */
  cardWidth: number;
  /** Horizontal gap between columns, in pixels. */
  columnGap: number;
  /** Vertical gap between rows, in pixels. */
  rowGap: number;
  /** Height estimate for an item before it has been measured. */
  estimateItemHeight: number;
  /** Stable key per item. Measured heights are cached by this key, so an item
   *  keeps its height (and DOM node) across reordering and re-grouping. */
  getItemKey: (index: number) => string;
  renderItem: (index: number) => ReactNode;
  /** Item that must always render and be scrolled into view. */
  pinnedIndex?: number | null;
  /** Rows to render beyond the viewport on each side. */
  overscan?: number;
  /** Called with the container's content width whenever it changes. */
  onWidthChange?: (width: number) => void;
  className?: string;
  /** Extra props for the container element (e.g. drag-and-drop handlers). */
  containerProps?: HTMLAttributes<HTMLDivElement>;
}

/**
 * Multi-column windowing grid. Every item is positioned individually under one stable container
 * and keyed by its own id, so reordering or changing the column count repositions existing DOM
 * nodes instead of remounting them and discarding their measured heights.
 *
 * A row's height is the tallest item in it; items are top-aligned (measured at natural size).
 */
export function VirtualGrid({
  scrollRef,
  itemCount,
  columns,
  cardWidth,
  columnGap,
  rowGap,
  estimateItemHeight,
  getItemKey,
  renderItem,
  pinnedIndex = null,
  overscan,
  onWidthChange,
  className,
  containerProps,
}: VirtualGridProps) {
  const { containerRef, setContainerEl, measured } = useVirtualScaffold(
    itemCount,
    getItemKey,
    () => estimateItemHeight,
    onWidthChange,
  );

  const rowCount = Math.ceil(itemCount / Math.max(1, columns));

  // A row is as tall as its tallest item.
  const rowHeight = useCallback(
    (rowIndex: number) => {
      let max = 0;
      for (let col = 0; col < columns; col++) {
        const index = rowIndex * columns + col;
        if (index >= itemCount) {
          break;
        }
        const height =
          measured.getHeight(getItemKey(index)) ?? estimateItemHeight;
        if (height > max) {
          max = height;
        }
      }
      return max || estimateItemHeight;
    },
    [columns, itemCount, measured, getItemKey, estimateItemHeight],
  );

  const pinnedRow =
    pinnedIndex != null && pinnedIndex >= 0
      ? Math.floor(pinnedIndex / Math.max(1, columns))
      : null;

  const { totalHeight, virtualRows, scrollToIndex } = useVirtualizer({
    scrollRef,
    containerRef,
    count: rowCount,
    rowHeight,
    heightsVersion: measured.version,
    consumeDirtyFrom: measured.consumeDirtyFrom,
    // A column-count change re-groups which items share a row, so every row's
    // height may change without any measurement firing — force a full rebuild.
    layoutKey: columns,
    gap: rowGap,
    overscan,
    pinnedIndex: pinnedRow,
  });

  useLayoutEffect(() => {
    if (pinnedRow != null && pinnedRow >= 0) {
      scrollToIndex(pinnedRow);
    }
  }, [pinnedRow, scrollToIndex]);

  return (
    <div
      ref={setContainerEl}
      {...mergeContainerProps(containerProps, className, totalHeight)}
    >
      {virtualRows.flatMap((virtualRow) => {
        const cells: ReactNode[] = [];
        for (let col = 0; col < columns; col++) {
          const index = virtualRow.index * columns + col;
          if (index >= itemCount) {
            break;
          }
          const key = getItemKey(index);
          cells.push(
            <div
              key={key}
              ref={measured.measure(key, virtualRow.index)}
              className="absolute"
              style={{
                top: virtualRow.start,
                left: col * (cardWidth + columnGap),
                width: cardWidth,
              }}
            >
              {renderItem(index)}
            </div>,
          );
        }
        return cells;
      })}
    </div>
  );
}
