/**
 * All marketing copy and canvas layout for the landing experience.
 *
 * `src/canvas/seed.ts` places every region's `items` onto the live Myelin
 * canvas (the desktop experience). There is no static/mobile renderer right
 * now; when one is built it should be authored on its own, not derived from
 * these regions.
 *
 * Items are authored in each region's LOCAL coordinates (0,0 = the region's
 * top-left). Each region's `origin` translates it onto a non-overlapping path
 * across the canvas, so you can lay out a region without worrying about where
 * it sits in the wider tour. Coordinates are world units (px at zoom 1).
 */

/** Ink colors mirror the app's palette tokens (see packages/ui/theme.css). */
export const INK = {
  text: '#191c1e',
  navy: '#2f3e46',
  red: '#e03e3e',
  green: '#005236',
  muted: '#5b6677',
  highlight: 'rgba(251, 191, 36, 0.45)',
} as const;

export const FONT = {
  heading: '"Newsreader", Georgia, serif',
  body: '"Hanken Grotesk", Arial, sans-serif',
  hand: '"Caveat", cursive',
} as const;

/** Pre-baked ink gestures the seeder can draw (see src/canvas/ink.ts). */
export type InkGesture =
  | { path: 'underline'; width: number }
  | { path: 'circle'; width: number; height: number }
  | { path: 'arrow'; dx: number; dy: number }
  | { path: 'zigzag'; width: number }
  | { path: 'points'; points: [number, number][] };

export type CanvasItem =
  | {
      kind: 'text';
      role: 'display' | 'heading' | 'body' | 'caption';
      text: string;
      x: number;
      y: number;
      width: number;
      /** Marks the note visitors are invited to edit. */
      editable?: boolean;
    }
  | {
      kind: 'handwriting';
      text: string;
      x: number;
      y: number;
      size?: number;
      width?: number;
      color?: string;
    }
  | {
      kind: 'ink';
      gesture: InkGesture;
      x: number;
      y: number;
      color?: string;
      size?: number;
      /** Draw this stroke on over ~0.7s when the canvas first loads. */
      animate?: boolean;
    }
  | {
      kind: 'shape';
      shape: 'rect' | 'ellipse' | 'line' | 'triangle';
      /** rect/ellipse: [x, y, w, h]; line/triangle: flat [x, y, ...] pairs. */
      geom: number[];
      x: number;
      y: number;
      color?: string;
      size?: number;
    }
  | { kind: 'latex'; source: string; x: number; y: number; scale?: number }
  | { kind: 'image'; src: string; x: number; y: number; scale?: number }
  | {
      /**
       * A DOM affordance anchored to world coordinates (real links and
       * buttons; canvas pixels cannot be clicked or tabbed to). `slot` names
       * which piece of chrome renders here — see WorldLayer.tsx.
       */
      kind: 'dom';
      slot: 'download-card' | 'schema-link' | 'scroll-hint';
      x: number;
      y: number;
      width: number;
    };

export interface CanvasRegion {
  id: string;
  /** Command palette, progress rail, and app-tab label. */
  label: string;
  /**
   * Where this region's local (0,0) origin lands on the canvas world. Origins
   * form a gentle serpentine with generous gaps so no region's content bleeds
   * into a neighbor's framed view. `frame` and `items` are authored in local
   * coordinates; the exported `regions` shifts them by this origin.
   */
  origin: [number, number];
  frame: { x: number; y: number; width: number; height: number };
  items: CanvasItem[];
}

const authoredRegions: CanvasRegion[] = [];

function shiftItem(item: CanvasItem, dx: number, dy: number): CanvasItem {
  if (
    item.kind === 'shape' &&
    (item.shape === 'line' || item.shape === 'triangle')
  ) {
    // Line/triangle geometry is authored in absolute coordinates (element
    // offset stays at 0), so the points move, not the offset.
    const geom = item.geom.map((value, index) =>
      index % 2 === 0 ? value + dx : value + dy,
    );
    return { ...item, geom };
  }
  return { ...item, x: item.x + dx, y: item.y + dy };
}

/**
 * Shift each authored region from its local (0,0) frame onto its `origin` in
 * the canvas world, so the tour reads as one non-overlapping notebook.
 */
export const regions: CanvasRegion[] = authoredRegions.map((region) => {
  const [dx, dy] = region.origin;
  return {
    ...region,
    frame: {
      ...region.frame,
      x: region.frame.x + dx,
      y: region.frame.y + dy,
    },
    items: region.items.map((item) => shiftItem(item, dx, dy)),
  };
});

export const siteTitle =
  'Myelin Notes: handwriting, type, and PDFs in one note';
export const siteDescription =
  'Myelin Notes is a native, local-first canvas where handwriting, type, PDFs, images, and audio live in one note, kept on your own machine. Free while it is in early access.';
