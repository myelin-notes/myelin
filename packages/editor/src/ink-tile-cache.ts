import { CanvasPool } from './canvas-pool';
import type { DrawableElement } from './elements/drawable-element';
import { ElementType } from './elements/element-type';
import type { StrokeElement } from './elements/stroke-element';
import type { Vector2 } from './geometry';

// Device pixels; about 1 MB a tile.
const TILE_SIZE = 512;
/** Fewer strokes than this paint directly: it's cheap, and those notes pay no tile memory. */
export const MIN_TILED_STROKES = 1000;
// A frame missing tiles also draws the strokes directly, so this comes on top of a full draw.
const FILL_BUDGET_MS = 4;
// Antialiasing reaches past a stroke's bounds.
const INK_BLEED_PX = 2;
const POOLED_CANVASES = 32;

interface Tile {
  ix: number;
  iy: number;
  /** `null` when no ink lands here, so sparse notes allocate nothing for it. */
  canvas: HTMLCanvasElement | null;
}

// Everything that decides what a stroke paints. Compared rather than subscribed to: an anchored
// stroke's offset is computed on read, and moves with its frame without any signal.
interface StrokePaint {
  stroke: StrokeElement;
  order: number;
  path: Path2D;
  color: string;
  hidden: boolean;
  offsetX: number;
  offsetY: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  bounds: DOMRect;
}

export interface InkTileFrame {
  /** The half-open range of `elements` the tiles paint. */
  start: number;
  end: number;
  /** The view offset at whole device pixels. Draw the whole frame here, or ink shimmers on a miss. */
  offset: Vector2;
  /** Every visible tile exists: {@link InkTileCache.blit} them, else draw the range directly. */
  ready: boolean;
}

/**
 * Finished strokes rasterized into world-anchored tiles, so a pan costs a few image copies however
 * much ink is on screen: 4ms of JS a frame vs 16ms at 30% on an 8.9k-stroke note. Holds the longest
 * contiguous run of strokes, keeping z-order with whatever is drawn directly around it. Tiles are
 * sized for one exact zoom, so zoom gestures draw directly.
 */
export class InkTileCache {
  private readonly pool = new CanvasPool(POOLED_CANVASES);
  private readonly tiles = new Map<string, Tile>();
  private zoom = 0;
  private dpr = 0;
  private originX = 0;
  private originY = 0;
  private viewX0 = 0;
  private viewY0 = 0;
  private viewX1 = -1;
  private viewY1 = -1;
  private runElements: readonly DrawableElement[] | null = null;
  private runStart = 0;
  private runEnd = 0;
  private paints: StrokePaint[] = [];
  private paintsElements: readonly DrawableElement[] | null = null;
  private paintsEnd = 0;
  private fillPending = false;

  /** Tiles around the view are still missing, so filling them needs another frame. */
  public get pending(): boolean {
    return this.fillPending;
  }

  /**
   * Call once per frame before drawing. `null` means draw everything directly at the exact offset:
   * too few strokes to be worth tiling, or the zoom changed this frame.
   */
  public beginFrame(
    elements: readonly DrawableElement[],
    zoom: number,
    offset: Readonly<Vector2>,
    dpr: number,
    canvasWidth: number,
    canvasHeight: number,
  ): InkTileFrame | null {
    this.fillPending = false;
    if (elements !== this.runElements) {
      this.runElements = elements;
      [this.runStart, this.runEnd] = longestStrokeRun(elements);
    }
    // Live ink changes every sample, so it stays out of the tiles until the pen lifts.
    let end = this.runEnd;
    while (end > this.runStart && (elements[end - 1] as StrokeElement).isLive) {
      end--;
    }
    if (end - this.runStart < MIN_TILED_STROKES) {
      this.clear();
      this.paints = [];
      this.paintsElements = null;
      return null;
    }
    if (zoom !== this.zoom || dpr !== this.dpr) {
      this.clear();
      this.zoom = zoom;
      this.dpr = dpr;
      this.fillPending = true;
      return null;
    }

    if (elements !== this.paintsElements || end !== this.paintsEnd) {
      this.syncPaints(elements, this.runStart, end);
      this.paintsElements = elements;
      this.paintsEnd = end;
    }
    for (let i = 0; i < this.paints.length; i++) {
      const paint = this.paints[i];
      if (!paintChanged(paint)) {
        continue;
      }
      this.invalidate(paint.bounds);
      this.paints[i] = capturePaint(paint.stroke, paint.order);
      this.invalidate(this.paints[i].bounds);
    }

    const scale = zoom * dpr;
    this.originX = Math.round(offset.x * scale);
    this.originY = Math.round(offset.y * scale);
    this.viewX0 = Math.floor(-this.originX / TILE_SIZE);
    this.viewY0 = Math.floor(-this.originY / TILE_SIZE);
    this.viewX1 = Math.floor((canvasWidth - 1 - this.originX) / TILE_SIZE);
    this.viewY1 = Math.floor((canvasHeight - 1 - this.originY) / TILE_SIZE);
    const deadline = performance.now() + FILL_BUDGET_MS;
    const ready = this.fill(
      this.viewX0,
      this.viewY0,
      this.viewX1,
      this.viewY1,
      deadline,
    );
    // One ring beyond the view, so a pan finds its next tiles already painted.
    this.fillPending = !(
      ready &&
      this.fill(
        this.viewX0 - 1,
        this.viewY0 - 1,
        this.viewX1 + 1,
        this.viewY1 + 1,
        deadline,
      )
    );
    this.evict();
    return {
      start: this.runStart,
      end,
      offset: { x: this.originX / scale, y: this.originY / scale },
      ready,
    };
  }

  public blit(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (let iy = this.viewY0; iy <= this.viewY1; iy++) {
      for (let ix = this.viewX0; ix <= this.viewX1; ix++) {
        const canvas = this.tiles.get(tileKey(ix, iy))?.canvas;
        if (canvas) {
          ctx.drawImage(
            canvas,
            ix * TILE_SIZE + this.originX,
            iy * TILE_SIZE + this.originY,
          );
        }
      }
    }
    ctx.restore();
  }

  /** Drop every tile, for changes no stroke's own state shows, like the theme behind adaptive ink. */
  public clear(): void {
    for (const tile of this.tiles.values()) {
      this.releaseTile(tile);
    }
    this.tiles.clear();
  }

  public destroy(): void {
    this.clear();
    this.pool.drain();
  }

  // Survivors that kept their relative order paint the same, so only strokes that were added,
  // removed or moved past others can change any pixels.
  private syncPaints(
    elements: readonly DrawableElement[],
    start: number,
    end: number,
  ): void {
    const previous = new Map(this.paints.map((paint) => [paint.stroke, paint]));
    const paints = new Array<StrokePaint>(end - start);
    let lastOrder = -1;
    for (let i = start; i < end; i++) {
      const stroke = elements[i] as StrokeElement;
      const paint = previous.get(stroke);
      previous.delete(stroke);
      if (paint && paint.order > lastOrder) {
        lastOrder = paint.order;
        paint.order = i - start;
        paints[i - start] = paint;
        continue;
      }
      if (paint) {
        this.invalidate(paint.bounds);
      }
      paints[i - start] = capturePaint(stroke, i - start);
      this.invalidate(paints[i - start].bounds);
    }
    for (const paint of previous.values()) {
      this.invalidate(paint.bounds);
    }
    this.paints = paints;
  }

  private invalidate(bounds: DOMRect): void {
    const scale = this.zoom * this.dpr;
    const x0 = Math.floor((bounds.x * scale - INK_BLEED_PX) / TILE_SIZE);
    const y0 = Math.floor((bounds.y * scale - INK_BLEED_PX) / TILE_SIZE);
    const x1 = Math.floor((bounds.right * scale + INK_BLEED_PX) / TILE_SIZE);
    const y1 = Math.floor((bounds.bottom * scale + INK_BLEED_PX) / TILE_SIZE);
    for (const [key, tile] of this.tiles) {
      if (tile.ix >= x0 && tile.ix <= x1 && tile.iy >= y0 && tile.iy <= y1) {
        this.releaseTile(tile);
        this.tiles.delete(key);
      }
    }
  }

  private fill(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    deadline: number,
  ): boolean {
    // Checked after painting, so a stalled frame still makes progress and `pending` always clears.
    let overBudget = false;
    for (let iy = y0; iy <= y1; iy++) {
      for (let ix = x0; ix <= x1; ix++) {
        const key = tileKey(ix, iy);
        if (this.tiles.has(key)) {
          continue;
        }
        if (overBudget) {
          return false;
        }
        this.tiles.set(key, this.paintTile(ix, iy));
        overBudget = performance.now() >= deadline;
      }
    }
    return true;
  }

  private paintTile(ix: number, iy: number): Tile {
    const scale = this.zoom * this.dpr;
    const worldSize = TILE_SIZE / scale;
    const rect = new DOMRect(
      ix * worldSize,
      iy * worldSize,
      worldSize,
      worldSize,
    );
    const bleed = INK_BLEED_PX / scale;
    let canvas: HTMLCanvasElement | null = null;
    let ctx: CanvasRenderingContext2D | null = null;
    for (const { stroke } of this.paints) {
      if (!stroke.intersectsWorldRect(rect, bleed)) {
        continue;
      }
      if (!ctx) {
        canvas = this.pool.acquire();
        ctx = prepareTileContext(canvas);
        ctx.setTransform(scale, 0, 0, scale, -ix * TILE_SIZE, -iy * TILE_SIZE);
      }
      stroke.draw(ctx, 0);
    }
    return { ix, iy, canvas };
  }

  // Allows twice what the view needs before dropping anything, so panning back and forth across a
  // tile boundary doesn't repaint the same tiles.
  private evict(): void {
    const x0 = this.viewX0 - 1;
    const y0 = this.viewY0 - 1;
    const x1 = this.viewX1 + 1;
    const y1 = this.viewY1 + 1;
    if (this.tiles.size <= 2 * (x1 - x0 + 1) * (y1 - y0 + 1)) {
      return;
    }
    for (const [key, tile] of this.tiles) {
      if (tile.ix < x0 || tile.ix > x1 || tile.iy < y0 || tile.iy > y1) {
        this.releaseTile(tile);
        this.tiles.delete(key);
      }
    }
  }

  private releaseTile(tile: Tile): void {
    if (tile.canvas) {
      this.pool.release(tile.canvas);
    }
  }
}

function tileKey(ix: number, iy: number): string {
  return `${ix},${iy}`;
}

function prepareTileContext(
  canvas: HTMLCanvasElement,
): CanvasRenderingContext2D {
  if (canvas.width !== TILE_SIZE || canvas.height !== TILE_SIZE) {
    canvas.width = TILE_SIZE;
    canvas.height = TILE_SIZE;
  }
  const ctx = canvas.getContext('2d', { alpha: true })!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, TILE_SIZE, TILE_SIZE);
  return ctx;
}

function longestStrokeRun(
  elements: readonly DrawableElement[],
): [number, number] {
  let bestStart = 0;
  let bestEnd = 0;
  let start = 0;
  for (let i = 0; i <= elements.length; i++) {
    if (i < elements.length && elements[i].type === ElementType.STROKE) {
      continue;
    }
    if (i - start > bestEnd - bestStart) {
      bestStart = start;
      bestEnd = i;
    }
    start = i + 1;
  }
  return [bestStart, bestEnd];
}

function capturePaint(stroke: StrokeElement, order: number): StrokePaint {
  const { offset, scale } = stroke;
  return {
    stroke,
    order,
    path: stroke.paintPath,
    color: stroke.strokeStyle.color,
    hidden: stroke.hidden,
    offsetX: offset.x,
    offsetY: offset.y,
    scaleX: scale.x,
    scaleY: scale.y,
    rotation: stroke.rotation,
    bounds: stroke.boundingBox,
  };
}

function paintChanged(paint: StrokePaint): boolean {
  const { stroke } = paint;
  const { offset, scale } = stroke;
  return (
    offset.x !== paint.offsetX ||
    offset.y !== paint.offsetY ||
    scale.x !== paint.scaleX ||
    scale.y !== paint.scaleY ||
    stroke.rotation !== paint.rotation ||
    stroke.hidden !== paint.hidden ||
    stroke.paintPath !== paint.path ||
    stroke.strokeStyle.color !== paint.color
  );
}
