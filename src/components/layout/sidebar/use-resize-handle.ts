import { useCallback, useRef } from 'react';

interface ResizeHandleOptions {
  /** Axis the pointer travels along to resize. */
  axis: 'x' | 'y';
  /** Current size in pixels. */
  value: number;
  /** Apply a new size; the caller is responsible for clamping and persisting. */
  onChange: (next: number) => void;
  /** When true, moving toward the origin (left / up) grows the value. */
  invert?: boolean;
  keyboardStep?: number;
}

export interface ResizeHandleProps {
  onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerMove: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerUp: (e: React.PointerEvent<HTMLElement>) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => void;
  style: React.CSSProperties;
}

/**
 * Pointer + keyboard drag logic shared by the sidebar (horizontal) and tags
 * (vertical) resize handles. Uses pointer capture so the drag keeps tracking
 * even when the cursor leaves the thin handle. Spread the returned props onto
 * the handle element; clamping and persistence live in the caller's `onChange`.
 *
 * The pane splits use react-resizable-panels instead, but that is percentage
 * based and tied to the split tree — these handles need fixed pixel sizes.
 */
export function useResizeHandle({
  axis,
  value,
  onChange,
  invert = false,
  keyboardStep = 16,
}: ResizeHandleOptions): ResizeHandleProps {
  const startRef = useRef<{ pos: number; value: number } | null>(null);
  const sign = invert ? -1 : 1;

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      startRef.current = { pos: axis === 'x' ? e.clientX : e.clientY, value };
    },
    [axis, value],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      const start = startRef.current;
      if (!start) {
        return;
      }
      const pos = axis === 'x' ? e.clientX : e.clientY;
      onChange(start.value + sign * (pos - start.pos));
    },
    [axis, onChange, sign],
  );

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (!startRef.current) {
      return;
    }
    startRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLElement>) => {
      const growKey = axis === 'x' ? 'ArrowRight' : 'ArrowUp';
      const shrinkKey = axis === 'x' ? 'ArrowLeft' : 'ArrowDown';
      if (e.key === growKey) {
        e.preventDefault();
        onChange(value + keyboardStep);
      } else if (e.key === shrinkKey) {
        e.preventDefault();
        onChange(value - keyboardStep);
      }
    },
    [axis, keyboardStep, onChange, value],
  );

  // Without this, touch devices claim the drag as a scroll/pan gesture and fire
  // pointercancel, so the handle never moves on iPad. Covers the descendant grab
  // zone too, since ancestor touch-action applies to touches on children.
  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onKeyDown,
    style: { touchAction: 'none' },
  };
}
