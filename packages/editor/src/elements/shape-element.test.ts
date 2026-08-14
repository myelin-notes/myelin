import { describe, expect, it, vi } from 'vitest';
import type { PageItem } from '../pdf-export/contract';
import type { PdfHarvestContext } from '../pdf-export/harvest';
import { YDocManager } from '../ydoc-manager';
import { ElementType } from './element-type';
import { ShapeElement } from './shape-element';
import type { StrokeStyle } from './stroke-element';

const STYLE: StrokeStyle = { color: '#191c1e', size: 8 };

/**
 * Simulate the canvas addElement → bind path: write the element's getYMapProps
 * (with the points Y.Array) into a real Y.Map, then bind a fresh element to it.
 */
function persistAndReload(source: ShapeElement): ShapeElement {
  const ydoc = new YDocManager();
  const props = {
    offsetX: source.offset.x,
    offsetY: source.offset.y,
    scaleX: source.scale.x,
    scaleY: source.scale.y,
    ...source.getYMapProps(),
  };
  const yMap = ydoc.createElementMap(ElementType.SHAPE, source.uuid, props);
  // First bind the source (seeds the empty points Y.Array from initialGeom).
  source.bindToYMap(yMap);
  // Reload: a brand-new placeholder element binds to the same Y.Map.
  const reloaded = new ShapeElement(source.uuid, 'rect', [0, 0, 0, 0], {
    color: 'x',
    size: 1,
  });
  reloaded.bindToYMap(yMap);
  return reloaded;
}

describe('ShapeElement persistence', () => {
  it('round-trips a rect through Yjs', () => {
    const src = new ShapeElement('s1', 'rect', [0, 0, 200, 100], STYLE);
    src.setOffset(10, 20);
    const reloaded = persistAndReload(src);

    expect(reloaded.shapeType).toBe('rect');
    expect(reloaded.localBoundingBox.width).toBe(200);
    expect(reloaded.localBoundingBox.height).toBe(100);
    expect(reloaded.boundingBox.x).toBe(10);
    expect(reloaded.boundingBox.y).toBe(20);
  });

  it('round-trips an ellipse', () => {
    const src = new ShapeElement('s2', 'ellipse', [0, 0, 80, 60], STYLE);
    const reloaded = persistAndReload(src);
    expect(reloaded.shapeType).toBe('ellipse');
    expect(reloaded.localBoundingBox.width).toBe(80);
  });

  it('round-trips a line', () => {
    const src = new ShapeElement('s3', 'line', [0, 0, 100, 40], STYLE);
    const reloaded = persistAndReload(src);
    expect(reloaded.shapeType).toBe('line');
    expect(reloaded.localBoundingBox.width).toBe(100);
    expect(reloaded.localBoundingBox.height).toBe(40);
  });

  it('round-trips a triangle', () => {
    const src = new ShapeElement(
      's4',
      'triangle',
      [50, 0, 100, 80, 0, 80],
      STYLE,
    );
    const reloaded = persistAndReload(src);
    expect(reloaded.shapeType).toBe('triangle');
    expect(reloaded.localBoundingBox.width).toBe(100);
    expect(reloaded.localBoundingBox.height).toBe(80);
  });

  it('stores geometry directly as a flat value and survives a re-bind (reload)', () => {
    const ydoc = new YDocManager();
    const src = new ShapeElement('s5', 'rect', [0, 0, 120, 90], STYLE);
    const yMap = ydoc.createElementMap(ElementType.SHAPE, 's5', {
      offsetX: 0,
      offsetY: 0,
      scaleX: 1,
      scaleY: 1,
      ...src.getYMapProps(),
    });
    // Geometry is a single flat array value, written at creation (no seeding).
    expect(yMap.get('geom')).toEqual([0, 0, 120, 90]);

    src.bindToYMap(yMap);

    const reloaded = new ShapeElement('s5', 'rect', [0, 0, 0, 0], STYLE);
    reloaded.bindToYMap(yMap);
    expect(reloaded.localBoundingBox.width).toBe(120);
    expect(reloaded.localBoundingBox.height).toBe(90);
  });
});

describe('ShapeElement resize', () => {
  /** Bind a shape to a real Y.Map (seeds the points Y.Array) and return the map. */
  function bind(shape: ShapeElement) {
    const ydoc = new YDocManager();
    const yMap = ydoc.createElementMap(ElementType.SHAPE, shape.uuid, {
      offsetX: shape.offset.x,
      offsetY: shape.offset.y,
      scaleX: shape.scale.x,
      scaleY: shape.scale.y,
      ...shape.getYMapProps(),
    });
    shape.bindToYMap(yMap);
    return yMap;
  }

  /** The corner handle whose anchor is the top-left (drag grows right/down). */
  function bottomRightHandle(shape: ShapeElement) {
    const handle = shape
      .getHandles()
      .find(
        (h) => h.scaleX && h.scaleY && h.anchorFx === 0 && h.anchorFy === 0,
      );
    if (!handle) {
      throw new Error('no bottom-right handle');
    }
    return handle;
  }

  it('bakes a rect resize into geometry and leaves scale at 1', () => {
    const shape = new ShapeElement('rs', 'rect', [0, 0, 100, 60], {
      color: '#000',
      size: 8,
    });
    const yMap = bind(shape);
    const h = bottomRightHandle(shape);

    shape.beginResize();
    shape.applyResize({
      handle: h,
      originalScale: { x: 1, y: 1 },
      originalOffset: { x: 0, y: 0 },
      ratioX: 2,
      ratioY: 2,
      anchorWorld: h.anchor,
    });
    shape.endResize();

    // Scale is untouched — the points moved instead, so stroke width is constant.
    expect(shape.scale).toEqual({ x: 1, y: 1 });
    expect(shape.localBoundingBox.width).toBeCloseTo(200);
    expect(shape.localBoundingBox.height).toBeCloseTo(120);
    // Top-left anchor stays pinned.
    expect(shape.boundingBox.x).toBeCloseTo(0);
    expect(shape.boundingBox.y).toBeCloseTo(0);

    // The new geometry is persisted to the Y.Array and survives a reload.
    const reloaded = new ShapeElement('rs', 'rect', [0, 0, 0, 0], {
      color: 'x',
      size: 1,
    });
    reloaded.bindToYMap(yMap);
    expect(reloaded.scale).toEqual({ x: 1, y: 1 });
    expect(reloaded.localBoundingBox.width).toBeCloseTo(200);
    expect(reloaded.localBoundingBox.height).toBeCloseTo(120);
  });

  it('moves line endpoints on resize (no render scale)', () => {
    const shape = new ShapeElement('ls', 'line', [0, 0, 100, 40], {
      color: '#000',
      size: 8,
    });
    bind(shape);
    const h = bottomRightHandle(shape);

    shape.beginResize();
    shape.applyResize({
      handle: h,
      originalScale: { x: 1, y: 1 },
      originalOffset: { x: 0, y: 0 },
      ratioX: 2,
      ratioY: 2,
      anchorWorld: h.anchor,
    });
    shape.endResize();

    expect(shape.scale).toEqual({ x: 1, y: 1 });
    expect(shape.localBoundingBox.width).toBeCloseTo(200);
    expect(shape.localBoundingBox.height).toBeCloseTo(80);
  });
});

describe('ShapeElement bounding box', () => {
  it('gives a horizontal line a selectable box', () => {
    // The recognizer levels near-horizontal lines, so both endpoints share a y.
    // A zero-height box is unhittable: inBox uses strict inequalities and
    // marquee selection compares against the box area.
    const shape = new ShapeElement('hl', 'line', [0, 0, 200, 0], STYLE);
    shape.setOffset(50, 100);

    const box = shape.boundingBox;
    expect(box.height).toBe(STYLE.size);
    expect(box.width).toBe(200);
    // Centered on the geometry, so the drawn stroke sits inside the box.
    expect(box.y).toBe(100 - STYLE.size / 2);
    // A click on the line lands strictly inside.
    expect(box.y < 100 && 100 < box.bottom).toBe(true);
  });

  it('leaves a box wider than the stroke untouched', () => {
    const shape = new ShapeElement('r', 'rect', [0, 0, 200, 100], STYLE);
    expect(shape.localBoundingBox).toEqual(new DOMRect(0, 0, 200, 100));
  });
});

function makePdfCtx(): { ctx: PdfHarvestContext; items: PageItem[] } {
  const items: PageItem[] = [];
  const ctx: PdfHarvestContext = {
    worldToPagePt: (wx, wy) => ({ x: wx * 2, y: wy * 2 }),
    ptPerWorldY: 2,
    push: (item) => items.push(item),
    addImageBase64: vi.fn(() => 0),
    addFontBase64: vi.fn(() => 0),
  };
  return { ctx, items };
}

describe('ShapeElement drawToPdf', () => {
  it('emits one width-carrying line for a line shape', () => {
    const shape = new ShapeElement('l', 'line', [0, 0, 100, 50], STYLE);
    shape.setOffset(0, 0);
    const { ctx, items } = makePdfCtx();
    shape.drawToPdf(ctx);

    expect(items).toHaveLength(1);
    const it = items[0];
    expect(it.t).toBe('line');
    if (it.t === 'line') {
      expect(it.width).toBe(16); // ptPerWorldY(2) * size(8)
      expect(it.x1).toBe(0);
      expect(it.x2).toBe(200); // worldToPagePt scales by 2
      expect(it.y2).toBe(100);
    }
  });

  it('emits 4 lines for a rect', () => {
    const shape = new ShapeElement('r', 'rect', [0, 0, 100, 60], STYLE);
    const { ctx, items } = makePdfCtx();
    shape.drawToPdf(ctx);
    expect(items).toHaveLength(4);
    expect(items.every((i) => i.t === 'line')).toBe(true);
  });

  it('emits 3 lines for a triangle', () => {
    const shape = new ShapeElement(
      't',
      'triangle',
      [50, 0, 100, 80, 0, 80],
      STYLE,
    );
    const { ctx, items } = makePdfCtx();
    shape.drawToPdf(ctx);
    expect(items).toHaveLength(3);
    expect(items.every((i) => i.t === 'line')).toBe(true);
  });

  it('emits N segments for an ellipse and never a bare path', () => {
    const shape = new ShapeElement('e', 'ellipse', [0, 0, 80, 60], STYLE);
    const { ctx, items } = makePdfCtx();
    shape.drawToPdf(ctx);
    expect(items.length).toBeGreaterThan(8);
    expect(items.every((i) => i.t === 'line')).toBe(true);
    expect(items.some((i) => i.t === 'path' || i.t === 'rect')).toBe(false);
  });

  it('skips degenerate (sub-pixel) shapes', () => {
    const shape = new ShapeElement('d', 'rect', [0, 0, 0.5, 0.5], STYLE);
    const { ctx, items } = makePdfCtx();
    shape.drawToPdf(ctx);
    expect(items).toHaveLength(0);
  });
});
