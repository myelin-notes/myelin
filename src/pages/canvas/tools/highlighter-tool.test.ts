import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { catalogs } from '@/lib/i18n/messages';
import type { DrawableCanvas, Vector2 } from '../drawable-canvas';
import type { DrawableElement } from '../elements/drawable-element';
import { ShapeElement } from '../elements/shape-element';
import { StrokeElement } from '../elements/stroke-element';
import { YDocManager } from '../ydoc-manager';
import { HighlighterTool } from './highlighter-tool';

type Pt = [number, number];

/** Dense closed rectangle perimeter polyline. */
function rectStroke(
  x: number,
  y: number,
  w: number,
  h: number,
  per = 20,
): Pt[] {
  const corners: Pt[] = [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
    [x, y],
  ];
  const out: Pt[] = [];
  for (let c = 0; c < corners.length - 1; c++) {
    const [ax, ay] = corners[c];
    const [bx, by] = corners[c + 1];
    for (let i = 0; i < per; i++) {
      const t = i / per;
      out.push([ax + (bx - ax) * t, ay + (by - ay) * t]);
    }
  }
  out.push([x, y]);
  return out;
}

function makeCanvas() {
  const ydoc = new YDocManager();
  const created: DrawableElement[] = [];
  let n = 0;

  const removeElement = vi.fn((el: DrawableElement) => {
    if (el.yMap) {
      ydoc.removeElementMap(el.yMap);
    }
  });
  const transact = vi.fn((fn: () => void) => {
    fn();
  });

  const addElement = vi.fn(
    <T extends DrawableElement>(factory: (uuid: string) => T): T => {
      const el = factory(`test-uuid-${n++}`);
      const props = {
        offsetX: el.offset.x,
        offsetY: el.offset.y,
        scaleX: el.scale.x,
        scaleY: el.scale.y,
        ...el.getYMapProps(),
      };
      const yMap = ydoc.createElementMap(el.type, el.uuid, props);
      el.bindToYMap(yMap);
      created.push(el);
      return el;
    },
  );

  const canvas = {
    addElement,
    removeElement,
    transact,
  } as unknown as DrawableCanvas;

  return { canvas, ydoc, created, addElement, removeElement, transact };
}

const PRESSURE_EVENT = { pressure: 0.5 } as PointerEvent;

function pos(x: number, y: number): Vector2 {
  return { x, y };
}

function feed(
  tool: { update: (c: DrawableCanvas, e: PointerEvent, p: Vector2) => void },
  canvas: DrawableCanvas,
  pts: Pt[],
): void {
  for (const [x, y] of pts) {
    tool.update(canvas, PRESSURE_EVENT, pos(x, y));
  }
}

function makeTool(): HighlighterTool {
  return new HighlighterTool(() => catalogs.en);
}

describe('HighlighterTool does not snap into shapes', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps a held rectangle stroke as a StrokeElement (no shape snap)', () => {
    const { canvas, created, removeElement } = makeCanvas();
    const tool = makeTool();
    tool.start(canvas, {} as PointerEvent);
    const stroke = created[0] as StrokeElement;
    expect(stroke).toBeInstanceOf(StrokeElement);

    // Draw a clean rectangle (would be recognized by the pen), then hold still.
    feed(tool, canvas, rectStroke(10, 20, 200, 120));
    vi.advanceTimersByTime(600);

    // The highlighter must NOT convert the stroke into a shape.
    expect(removeElement).not.toHaveBeenCalled();
    expect(created).toHaveLength(1);
    expect(
      (created as DrawableElement[]).some((e) => e instanceof ShapeElement),
    ).toBe(false);

    // Stroke keeps accepting points.
    const before = stroke.xyPoints.length;
    tool.update(canvas, PRESSURE_EVENT, pos(500, 500));
    expect(stroke.xyPoints.length).toBe(before + 1);
  });
});
