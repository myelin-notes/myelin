import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DrawableElement } from './elements/drawable-element';
import { StrokeElement } from './elements/stroke-element';
import {
  InkTileCache,
  type InkTileFrame,
  MIN_TILED_STROKES,
} from './ink-tile-cache';

const TILE = 512;
const CANVAS_WIDTH = 1024;
const CANVAS_HEIGHT = 512;

class FakeContext {
  public fills: Path2D[] = [];
  public clears = 0;
  public transform: number[] = [];
  public readonly images: { canvas: FakeCanvas; x: number; y: number }[] = [];
  public fillStyle = '';

  public save(): void {}
  public restore(): void {}
  public translate(): void {}
  public rotate(): void {}
  public scale(): void {}
  public setTransform(...transform: number[]): void {
    this.transform = transform;
  }
  public clearRect(): void {
    this.clears += 1;
    this.fills = [];
  }
  public fill(path: Path2D): void {
    this.fills.push(path);
  }
  public drawImage(canvas: FakeCanvas, x: number, y: number): void {
    this.images.push({ canvas, x, y });
  }
}

class FakeCanvas {
  public width = 300;
  public height = 150;
  public readonly ctx = new FakeContext();

  public getContext(): FakeContext {
    return this.ctx;
  }
}

function strokeAt(x: number, y: number, uuid = `${x},${y}`): StrokeElement {
  const stroke = new StrokeElement(
    uuid,
    [x, y, 0.5, x + 2, y, 0.5, x + 4, y + 1, 0.5],
    false,
    { color: '#ff0000', size: 2 },
  );
  stroke.updateBounds();
  return stroke;
}

// Enough far-away ink to turn tiling on without landing in any tile these tests look at.
function withFiller(...strokes: StrokeElement[]): DrawableElement[] {
  const filler = Array.from({ length: MIN_TILED_STROKES }, (_, i) =>
    strokeAt(1e7 + i, 1e7, `filler-${i}`),
  );
  return [...filler, ...strokes];
}

describe('InkTileCache', () => {
  let created: FakeCanvas[];
  let cache: InkTileCache;

  beforeEach(() => {
    created = [];
    vi.stubGlobal('document', {
      createElement: () => {
        const canvas = new FakeCanvas();
        created.push(canvas);
        return canvas;
      },
    });
    cache = new InkTileCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const frame = (
    elements: readonly DrawableElement[],
    { zoom = 1, x = 0, y = 0, dpr = 2 } = {},
  ): InkTileFrame | null =>
    cache.beginFrame(
      elements,
      zoom,
      { x, y },
      dpr,
      CANVAS_WIDTH,
      CANVAS_HEIGHT,
    );

  function settled(
    elements: readonly DrawableElement[],
    view: { zoom?: number; x?: number; y?: number; dpr?: number } = {},
  ): InkTileFrame {
    let result = frame(elements, view);
    while (cache.pending || !result) {
      result = frame(elements, view);
    }
    return result;
  }

  // The tile the frame composites at device position (x, y).
  function tileAt(x: number, y: number): FakeContext | undefined {
    const main = new FakeContext();
    cache.blit(main as unknown as CanvasRenderingContext2D);
    return main.images.find(
      (image) =>
        x >= image.x &&
        x < image.x + TILE &&
        y >= image.y &&
        y < image.y + TILE,
    )?.canvas.ctx;
  }

  // By identity, in order: every Path2D stub looks the same to toEqual.
  function expectPainted(tile: FakeContext | undefined, paths: Path2D[]) {
    expect(tile?.fills.length).toBe(paths.length);
    paths.forEach((path, i) => {
      expect(tile?.fills[i]).toBe(path);
    });
  }

  it('leaves a small note on the direct path, with no tile memory', () => {
    const elements = [strokeAt(10, 10)];

    expect(frame(elements)).toBeNull();
    expect(frame(elements)).toBeNull();
    expect(created).toHaveLength(0);
    expect(cache.pending).toBe(false);
  });

  it('draws directly while the zoom changes, and tiles once it settles', () => {
    const elements = withFiller(strokeAt(10, 10));

    expect(frame(elements, { zoom: 1 })).toBeNull();
    expect(frame(elements, { zoom: 1.1 })).toBeNull();
    expect(frame(elements, { zoom: 1.2 })).toBeNull();
    // The gesture's last frame still has to ask for the frame that starts filling.
    expect(cache.pending).toBe(true);
    expect(frame(elements, { zoom: 1.2 })).not.toBeNull();
  });

  it('repaints at the new zoom rather than showing tiles from the old one', () => {
    const elements = withFiller(strokeAt(10, 10));
    settled(elements, { zoom: 1 });

    settled(elements, { zoom: 2 });

    const scaleOf = tileAt(0, 0)?.transform[0];
    expect(scaleOf).toBe(4);
  });

  it('allocates nothing for tiles with no ink', () => {
    settled(withFiller());

    expect(created).toHaveLength(0);
  });

  it.each([
    { zoom: 0.6, dpr: 2, x: 123.37, y: -45.21 },
    { zoom: 1.3, dpr: 1, x: -8.4, y: 77.77 },
    { zoom: 5, dpr: 2, x: 0.013, y: -0.47 },
  ])('puts tiled ink where a direct draw of the frame would ($zoom, $dpr)', (view) => {
    const worldX = 40.5;
    const worldY = 12.25;
    const scale = view.zoom * view.dpr;
    const result = settled(withFiller(strokeAt(worldX, worldY)), view);

    const exactX = (worldX + view.x) * scale;
    const exactY = (worldY + view.y) * scale;
    const directX = (worldX + result.offset.x) * scale;
    const directY = (worldY + result.offset.y) * scale;
    // The snap stays under half a device pixel, and lands on whole ones so a tile copy is lossless.
    expect(Math.abs(directX - exactX)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(directY - exactY)).toBeLessThanOrEqual(0.5);
    expect(result.offset.x * scale).toBeCloseTo(
      Math.round(result.offset.x * scale),
      6,
    );

    const main = new FakeContext();
    cache.blit(main as unknown as CanvasRenderingContext2D);
    const painted = main.images.find((image) => image.canvas.ctx.fills.length);
    const [a, , , d, e, f] = painted!.canvas.ctx.transform;
    expect(a * worldX + e + painted!.x).toBeCloseTo(directX, 6);
    expect(d * worldY + f + painted!.y).toBeCloseTo(directY, 6);
  });

  it('never leaves a stroke crossing a tile seam out of either tile', () => {
    // World x 256 is the seam between the first two tiles at zoom 1, dpr 2.
    const crossing = strokeAt(254, 40);
    settled(withFiller(crossing));

    expect(tileAt(0, 0)?.fills).toContain(crossing.paintPath);
    expect(tileAt(TILE, 0)?.fills).toContain(crossing.paintPath);
  });

  describe('repaints what a stroke changed', () => {
    it('when it moves', () => {
      const stroke = strokeAt(10, 10);
      const elements = withFiller(stroke);
      settled(elements);
      expect(tileAt(0, 0)?.fills).toContain(stroke.paintPath);

      stroke.setOffset(300, 0);
      settled(elements);

      expect(tileAt(0, 0)).toBeUndefined();
      expect(tileAt(TILE, 0)?.fills).toContain(stroke.paintPath);
    });

    it('when it is hidden', () => {
      const stroke = strokeAt(10, 10);
      const neighbour = strokeAt(30, 10);
      const elements = withFiller(stroke, neighbour);
      settled(elements);

      stroke.hidden = true;
      settled(elements);

      expectPainted(tileAt(0, 0), [neighbour.paintPath]);
    });

    it('when its points are replaced', () => {
      const stroke = strokeAt(10, 10);
      const elements = withFiller(stroke);
      settled(elements);
      const before = stroke.paintPath;

      stroke.replacePoints([10, 10, 0.5, 40, 10, 0.5, 80, 20, 0.5]);
      settled(elements);

      expectPainted(tileAt(0, 0), [stroke.paintPath]);
      expect(stroke.paintPath).not.toBe(before);
    });

    it('when its anchor moves with no signal at all', () => {
      const stroke = strokeAt(0, 0);
      stroke.setPageAnchor({
        kind: 'pdf',
        frameId: 'pdf',
        page: 0,
        x: 0,
        y: 0,
        scaleX: 1,
        scaleY: 1,
      });
      let origin = { x: 10, y: 10 };
      stroke.anchorOrigin = () => origin;
      const elements = withFiller(stroke);
      settled(elements);
      expect(tileAt(0, 0)?.fills).toContain(stroke.paintPath);

      origin = { x: 300, y: 10 };
      settled(elements);

      expect(tileAt(0, 0)).toBeUndefined();
      expect(tileAt(TILE, 0)?.fills).toContain(stroke.paintPath);
    });

    it('in the new order when strokes swap, and without a removed one', () => {
      const a = strokeAt(10, 10);
      const b = strokeAt(12, 10);
      const filler = withFiller();
      settled([...filler, a, b]);
      expectPainted(tileAt(0, 0), [a.paintPath, b.paintPath]);

      settled([...filler, b, a]);
      expectPainted(tileAt(0, 0), [b.paintPath, a.paintPath]);

      settled([...filler, a]);
      expectPainted(tileAt(0, 0), [a.paintPath]);
    });

    it('but leaves tiles elsewhere alone', () => {
      const left = strokeAt(10, 10);
      const right = strokeAt(300, 10);
      const elements = withFiller(left, right);
      settled(elements);
      const untouched = tileAt(TILE, 0)!;
      const clears = untouched.clears;

      left.setOffset(5, 5);
      settled(elements);

      expect(tileAt(TILE, 0)).toBe(untouched);
      expect(untouched.clears).toBe(clears);
    });
  });

  it('paints nothing again for a pan within the tiles it has', () => {
    const elements = withFiller(strokeAt(10, 10));
    settled(elements);
    const allocated = created.length;
    const tile = tileAt(0, 0)!;
    const clears = tile.clears;

    settled(elements, { x: -3 });

    expect(created).toHaveLength(allocated);
    expect(tile.clears).toBe(clears);
  });

  it('keeps live ink out of the tiles until the pen lifts', () => {
    const under = strokeAt(10, 10);
    const live = new StrokeElement('live', [], false, {
      color: '#0000ff',
      size: 2,
    });
    const elements = withFiller(under, live);
    live.addPoint(12, 10, 0.5);
    live.addPoint(14, 10, 0.5);
    live.addPoint(16, 11, 0.5);

    const during = settled(elements);
    const tile = tileAt(0, 0)!;
    const clears = tile.clears;
    expect(during.end).toBe(elements.length - 1);
    expectPainted(tile, [under.paintPath]);

    live.addPoint(18, 11, 0.5);
    settled(elements);
    expect(tile.clears).toBe(clears);

    live.updateBounds();
    live.commit();
    const after = settled(elements);
    expect(after.end).toBe(elements.length);
    expectPainted(tileAt(0, 0), [under.paintPath, live.paintPath]);
  });

  it('tiles only the longest stroke run, so z-order with other elements holds', () => {
    const shape = { type: 99 } as unknown as DrawableElement;
    const lower = strokeAt(10, 10, 'lower');
    const filler = withFiller();
    const upper = strokeAt(10, 10, 'upper');

    const result = settled([lower, shape, ...filler, shape, upper]);

    expect(result.start).toBe(2);
    expect(result.end).toBe(2 + filler.length);
  });

  it('never blanks a tile it has no time to paint, and finishes across frames', () => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => {
      now += 100;
      return now;
    });
    const elements = withFiller(strokeAt(10, 10), strokeAt(300, 10));
    frame(elements);

    // One tile per frame: the view is two tiles, plus a ring of ten more.
    const first = frame(elements)!;
    expect(first.ready).toBe(false);
    expect(cache.pending).toBe(true);

    let frames = 1;
    while (cache.pending && frames < 50) {
      frame(elements);
      frames += 1;
    }
    expect(frames).toBeLessThan(50);
    expect(frame(elements)?.ready).toBe(true);
  });

  it('does not keep more tile memory the further you pan', () => {
    const ink = Array.from({ length: 200 }, (_, i) => strokeAt(i * 200, 10));
    const elements = withFiller(...ink);
    const inUse = () => created.filter((c) => c.width === TILE).length;

    settled(elements);
    for (let x = 0; x < 40000; x += 512) {
      settled(elements, { x: -x });
    }
    const afterLongPan = inUse();
    for (let x = 40000; x > 0; x -= 512) {
      settled(elements, { x: -x });
    }

    // About 100 MB at most, for a viewport that needs a dozen tiles.
    expect(afterLongPan).toBeLessThan(100);
    expect(inUse()).toBeLessThan(100);
  });

  it('frees its canvases when destroyed', () => {
    const ink = Array.from({ length: 40 }, (_, i) => strokeAt(i * 20, 10));
    settled(withFiller(...ink));

    cache.destroy();

    expect(created.length).toBeGreaterThan(0);
    expect(created.every((canvas) => canvas.width === 1)).toBe(true);
  });
});
