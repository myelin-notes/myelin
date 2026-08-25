import { type RefObject, useCallback, useRef } from 'react';

interface ListContainer {
  /** Object ref to the container element, for the virtualizer's rect math. */
  containerRef: RefObject<HTMLDivElement | null>;
  setContainerEl: (el: HTMLDivElement | null) => void;
}

/**
 * Manages a virtualized list's container element. A callback ref keeps an
 * object ref in sync and reports the element's content width, surviving the
 * element un/remounting as surrounding states (loading, empty, populated)
 * toggle. `onWidthChange` is read live, so passing an inline function is fine.
 */
export function useListContainer(
  onWidthChange?: (width: number) => void,
): ListContainer {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widthObserverRef = useRef<ResizeObserver | null>(null);
  const onWidthChangeRef = useRef(onWidthChange);
  onWidthChangeRef.current = onWidthChange;

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

  return { containerRef, setContainerEl };
}
