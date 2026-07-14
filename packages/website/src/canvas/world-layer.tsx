import { type ReactNode, useEffect, useRef } from 'react';
import { ImageIcon } from 'lucide-react';
import type { DrawableCanvas } from '@myelin/editor/drawable-canvas';

interface WorldLayerProps {
  canvas: DrawableCanvas;
  zIndex: number;
  children: ReactNode;
}

/**
 * DOM plane locked to the canvas's world coordinates: children positioned with
 * absolute `left`/`top` in world units ride along with every pan, zoom, and
 * camera animation. This is how the site adds interactive HTML (buttons,
 * links, screenshot placeholders) "on the canvas" without inventing a new
 * persisted element type in the engine.
 *
 * The container ignores pointer events; interactive children opt back in with
 * `pointer-events-auto`.
 */
export function WorldLayer({ canvas, zIndex, children }: WorldLayerProps) {
  const planeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const plane = planeRef.current;
    if (!plane) {
      return;
    }
    const apply = () => {
      const { offset, zoom } = canvas.viewport;
      plane.style.transform = `scale(${zoom}) translate(${offset.x}px, ${offset.y}px)`;
    };
    apply();
    return canvas.viewport.onViewChange(apply);
  }, [canvas]);

  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      style={{ zIndex }}
    >
      {/* The plane needs a real size: absolutely-positioned children resolve
          their shrink-to-fit width against it, and a zero-sized plane would
          collapse them to min-content (one word per line). */}
      <div
        ref={planeRef}
        className="absolute top-0 left-0"
        style={{ transformOrigin: '0 0', width: 1_000_000, height: 1_000_000 }}
      >
        {children}
      </div>
    </div>
  );
}

interface PlaceholderProps {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
}

/** Dashed stand-in frame for a screenshot yet to be captured. */
export function Placeholder({ x, y, width, height, label }: PlaceholderProps) {
  return (
    <div
      className="absolute flex flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed"
      style={{
        left: x,
        top: y,
        width,
        height,
        borderColor: 'rgba(89, 100, 107, 0.4)',
        background: 'rgba(89, 100, 107, 0.05)',
        color: '#59646b',
      }}
    >
      <ImageIcon style={{ width: 44, height: 44 }} strokeWidth={1.5} />
      <span
        className="max-w-[85%] text-center"
        style={{ fontSize: 21, lineHeight: 1.4 }}
      >
        {label}
      </span>
    </div>
  );
}
