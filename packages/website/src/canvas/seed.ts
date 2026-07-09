import type { DrawableCanvas } from '@myelin/editor/drawable-canvas';
import { ImageElement } from '@myelin/editor/elements/image-element';
import { LatexElement } from '@myelin/editor/elements/latex/element';
import { ShapeElement } from '@myelin/editor/elements/shape-element';
import { StrokeElement } from '@myelin/editor/elements/stroke-element';
import { TextElement } from '@myelin/editor/elements/text/element';
import { type CanvasItem, type CanvasRegion, FONT, INK } from '../content/site';
import { gestureToPoints } from './ink';

/** A `dom` content item, waiting for WorldLayer to render chrome onto it. */
export interface DomAnchor {
  slot: 'download-card' | 'schema-link' | 'scroll-hint';
  x: number;
  y: number;
  width: number;
}

const TEXT_ROLE_STYLE = {
  display: { fontSize: 54, fontFamily: FONT.heading, color: INK.text },
  heading: { fontSize: 38, fontFamily: FONT.heading, color: INK.text },
  body: { fontSize: 19, fontFamily: FONT.body, color: '#43474a' },
  caption: { fontSize: 16, fontFamily: FONT.body, color: INK.muted },
} as const;

/** A stroke seeded empty, to be drawn on after load. */
interface PendingStroke {
  element: StrokeElement;
  points: number[];
}

function seedItem(
  dc: DrawableCanvas,
  item: CanvasItem,
  seed: number,
  anchors: DomAnchor[],
  pending: PendingStroke[],
): void {
  switch (item.kind) {
    case 'text': {
      const style = TEXT_ROLE_STYLE[item.role];
      const el = dc.addElement(
        (uuid) => new TextElement(uuid, item.text, { ...style }, item.width),
      );
      el.setOffset(item.x, item.y);
      break;
    }
    case 'handwriting': {
      const el = dc.addElement(
        (uuid) =>
          new TextElement(
            uuid,
            item.text,
            {
              fontSize: item.size ?? 30,
              fontFamily: FONT.hand,
              color: item.color ?? INK.navy,
            },
            item.width ?? 460,
          ),
      );
      el.setOffset(item.x, item.y);
      break;
    }
    case 'ink': {
      const points = gestureToPoints(item.gesture, seed);
      const el = dc.addElement(
        (uuid) =>
          new StrokeElement(uuid, item.animate ? [] : points, true, {
            color: item.color ?? INK.text,
            size: item.size ?? 4,
          }),
      );
      el.setOffset(item.x, item.y);
      if (item.animate) {
        pending.push({ element: el, points });
      }
      break;
    }
    case 'shape': {
      const el = dc.addElement(
        (uuid) =>
          new ShapeElement(uuid, item.shape, [...item.geom], {
            color: item.color ?? INK.navy,
            size: item.size ?? 3,
          }),
      );
      el.setOffset(item.x, item.y);
      break;
    }
    case 'latex': {
      const el = dc.addElement((uuid) => new LatexElement(uuid, item.source));
      el.setOffset(item.x, item.y);
      if (item.scale && item.scale !== 1) {
        el.setScale(item.scale, item.scale);
      }
      break;
    }
    case 'image': {
      const el = dc.addElement((uuid) => new ImageElement(uuid));
      el.setOffset(item.x, item.y);
      if (item.scale && item.scale !== 1) {
        el.setScale(item.scale, item.scale);
      }
      // Bytes load async; the element pops in when the fetch lands.
      fetch(item.src)
        .then((res) => (res.ok ? res.arrayBuffer() : null))
        .then((buf) => (buf ? el.setImageData(buf) : undefined))
        .catch(() => {});
      break;
    }
    case 'dom':
      anchors.push({ slot: item.slot, x: item.x, y: item.y, width: item.width });
      break;
  }
}

/**
 * Reveal each pending stroke point-by-point so the signature ink appears to be
 * drawn by hand. Starts after a short delay so it lands once the intro camera
 * settles, then clears undo history so the flourish is not something a stray
 * Ctrl+Z can peel back.
 */
function animateStrokes(dc: DrawableCanvas, pending: PendingStroke[]): void {
  if (pending.length === 0) {
    return;
  }
  const DELAY = 850;
  const DURATION = 700;
  const startAt = performance.now() + DELAY;
  const drawn = pending.map(() => 0);

  const tick = () => {
    const now = performance.now();
    const t = Math.min(1, Math.max(0, (now - startAt) / DURATION));
    let allDone = true;
    pending.forEach((stroke, i) => {
      const total = (stroke.points.length / 3) | 0;
      const target = Math.floor(t * total);
      for (let p = drawn[i]; p < target; p++) {
        stroke.element.addPoint(
          stroke.points[p * 3],
          stroke.points[p * 3 + 1],
          stroke.points[p * 3 + 2],
        );
      }
      drawn[i] = target;
      if (target < total) {
        allDone = false;
      }
    });
    if (allDone && t >= 1) {
      for (const stroke of pending) {
        stroke.element.commit();
      }
      dc.ydoc.undoManager.clear();
      return;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/**
 * Fill the in-memory canvas with the authored notebook. Returns the DOM
 * anchors (download cards, hints) for WorldLayer to render.
 */
export async function seedCanvas(
  dc: DrawableCanvas,
  regions: CanvasRegion[],
): Promise<DomAnchor[]> {
  // Text layout measures through canvas fonts; make sure the three families
  // are usable before elements compute their boxes.
  try {
    await Promise.all([
      document.fonts.load(`54px ${FONT.heading}`),
      document.fonts.load(`19px ${FONT.body}`),
      document.fonts.load(`30px ${FONT.hand}`),
    ]);
  } catch {
    // Fallback fonts still render; boxes are re-measured below when the
    // real faces finish loading.
  }

  const anchors: DomAnchor[] = [];
  const pending: PendingStroke[] = [];
  let seed = 1;
  dc.transact(() => {
    for (const region of regions) {
      for (const item of region.items) {
        seedItem(dc, item, seed++, anchors, pending);
      }
    }
  });

  // Late font arrivals change text metrics; re-measure every text box once
  // all faces settle.
  document.fonts.ready.then(() => {
    for (const el of dc.elements) {
      if (el instanceof TextElement) {
        el.updateBounds();
      }
    }
  });

  // The authored notebook is the document's starting state, not something a
  // visitor's Ctrl+Z should peel away.
  dc.ydoc.undoManager.clear();

  animateStrokes(dc, pending);

  return anchors;
}
