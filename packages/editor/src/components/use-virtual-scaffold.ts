import { type HTMLAttributes, type RefObject, useEffect, useMemo } from 'react';
import { cn } from '../utils';
import { useListContainer } from './use-list-container';
import {
  type MeasuredHeights,
  useMeasuredHeights,
} from './use-measured-heights';

interface VirtualScaffold {
  /** Object ref to the container element, for the virtualizer's rect math. */
  containerRef: RefObject<HTMLDivElement | null>;
  setContainerEl: (el: HTMLDivElement | null) => void;
  /** Measured-height cache, pruned to the live key set. */
  measured: MeasuredHeights;
}

// Prunes the measured-height cache down to the currently-present keys so it can't grow unbounded.
export function useVirtualScaffold(
  itemCount: number,
  getItemKey: (index: number) => string,
  estimateHeight: (index: number) => number,
  onWidthChange?: (width: number) => void,
): VirtualScaffold {
  const { containerRef, setContainerEl } = useListContainer(onWidthChange);
  const measured = useMeasuredHeights(estimateHeight);
  const { prune } = measured;

  const liveKeys = useMemo(() => {
    const keys = new Set<string>();
    for (let i = 0; i < itemCount; i++) {
      keys.add(getItemKey(i));
    }
    return keys;
  }, [itemCount, getItemKey]);

  // Pruning only affects future `getHeight` reads for keys that already left the set, so it can run
  // after commit rather than mutating the cache mid-render.
  useEffect(() => {
    prune(liveKeys);
  }, [prune, liveKeys]);

  return { containerRef, setContainerEl, measured };
}

// Merges caller-supplied `containerProps` (e.g. drag-and-drop handlers) with the component's own
// `className` and content height rather than letting either side silently win.
export function mergeContainerProps(
  containerProps: HTMLAttributes<HTMLDivElement> | undefined,
  className: string | undefined,
  totalHeight: number,
): HTMLAttributes<HTMLDivElement> {
  const {
    className: extraClassName,
    style: extraStyle,
    ...restProps
  } = containerProps ?? {};
  return {
    ...restProps,
    className: cn('relative', extraClassName, className),
    style: { ...extraStyle, height: totalHeight },
  };
}
