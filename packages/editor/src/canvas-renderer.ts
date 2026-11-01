import type * as Y from 'yjs';
import {
  type CanvasStyle,
  getCanvasStyle,
  subscribeCanvasStyle,
} from './canvas-style';
import { getCanvasPalette, onCanvasThemeChange } from './canvas-theme';
import type { CanvasViewport } from './canvas-viewport';
import type { DrawableElement } from './elements/drawable-element';
import { isBackgroundElement } from './elements/element-type';
import type { Vector2 } from './geometry';
import { InkTileCache } from './ink-tile-cache';
import type { PlacementController } from './placement-controller';
import type { Ruler } from './ruler';
import type { SelectionController } from './selection-controller';
import type { ITool } from './tools/tool';

/** Spacing of the background pattern, in world units. */
const BG_SPACING = 24;
// Below this screen spacing a level fades out and the next-coarser one takes over.
const BG_MIN_SPACING_PX = 12;

export interface BackgroundGridLevel {
  /** World spacing of the finest drawn lines; even multiples are drawn opaque. */
  step: number;
  /** Alpha of the odd multiples of `step`. */
  minorAlpha: number;
}

export function backgroundGridLevel(zoom: number): BackgroundGridLevel {
  if (!(zoom > 0)) {
    return { step: BG_SPACING, minorAlpha: 1 };
  }
  let step = BG_SPACING;
  while (step * zoom < BG_MIN_SPACING_PX) {
    step *= 2;
  }
  // 0 as this level's spacing reaches the minimum, where the next level's odd lines are exactly
  // this level's; 1 at twice the minimum, so a line's alpha never jumps across a level change.
  const minorAlpha = Math.min(
    1,
    (step * zoom - BG_MIN_SPACING_PX) / BG_MIN_SPACING_PX,
  );
  return { step, minorAlpha };
}

// Deliberately loose: strokes and glyphs paint outside their bounding box.
const CULL_MARGIN_PX = 128;

// Screen-constant, so zooming in doesn't drag a widening band of off-screen ink into frame.
export function cullMarginWorld(zoom: number): number {
  if (!(zoom > 0) || !Number.isFinite(zoom)) {
    return Number.POSITIVE_INFINITY;
  }
  return CULL_MARGIN_PX / zoom;
}

/**
 * The background is drawn as geometry on its own canvas below the DOM layers. A CSS tiled
 * background re-rasterized its whole layer on the CPU every zoom frame (40.4ms vs 19.3ms on iPad),
 * and a CanvasPattern fill of the viewport cost ~8ms; ~200 lines touch only the pixels they cover.
 */
export class CanvasRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly canvas: HTMLCanvasElement;
  private overlayCtx: CanvasRenderingContext2D | null = null;
  private overlayCanvas: HTMLCanvasElement | null = null;
  private bgCanvas: HTMLCanvasElement | null = null;
  private bgCtx: CanvasRenderingContext2D | null = null;
  private bgStyle: CanvasStyle;
  private bgImage: HTMLImageElement | null = null;
  private bgImagePattern: CanvasPattern | null = null;
  // The view the background canvas was last drawn for; '' forces the next frame to draw it.
  private bgDrawnKey = '';
  private unsubBgPref: (() => void) | null = null;
  private unsubTheme: (() => void) | null = null;
  private resizeObserver: ResizeObserver | null = null;

  // clearRect invalidates a full-viewport layer as thoroughly as drawing does, so an
  // unconditional clear re-uploads it for a transparent frame. Half of ~11ms/frame on iPad.
  private overlayHasContent = false;
  private readonly inkTiles = new InkTileCache();

  public constructor(
    foregroundCtx: CanvasRenderingContext2D,
    foregroundCanvas: HTMLCanvasElement,
    private readonly requestRedraw: () => void,
    doc: Y.Doc,
  ) {
    this.ctx = foregroundCtx;
    this.canvas = foregroundCanvas;
    this.bgStyle = getCanvasStyle(doc);
    this.syncSizeToContainer();
    this.unsubBgPref = subscribeCanvasStyle(doc, () => {
      this.setBackgroundStyle(getCanvasStyle(doc));
    });
    this.unsubTheme = onCanvasThemeChange(() => {
      // The theme grid color is read at draw time.
      this.bgDrawnKey = '';
      // Adaptive ink resolves against the theme.
      this.inkTiles.clear();
      this.requestRedraw();
    });
    // Pane width also changes on sidebar toggle/resize and pane splits, not just window resize.
    this.resizeObserver = new ResizeObserver(() => {
      this.syncSizeToContainer();
    });
    this.resizeObserver.observe(this.canvas);
  }

  public setBackgroundCanvas(canvas: HTMLCanvasElement): void {
    this.bgCanvas = canvas;
    this.bgCtx = canvas.getContext('2d', { alpha: true });
    this.bgImagePattern = null;
    this.resizeBackgroundCanvas(
      this.canvas.clientWidth,
      this.canvas.clientHeight,
    );
  }

  public setOverlayCanvas(canvas: HTMLCanvasElement): void {
    this.overlayCanvas = canvas;
    this.overlayCtx = canvas.getContext('2d', { alpha: true });
    this.resizeOverlayCanvas(this.canvas.clientWidth, this.canvas.clientHeight);
  }

  public setBackgroundStyle(style: CanvasStyle): void {
    this.bgStyle = style;
    const src = style.pattern === 'image' ? style.image?.src : undefined;
    if (src && this.bgImage?.src !== src) {
      const image = new Image();
      image.onload = () => {
        if (this.bgImage === image) {
          this.bgDrawnKey = '';
          this.requestRedraw();
        }
      };
      image.src = src;
      this.bgImage = image;
      this.bgImagePattern = null;
    }
    this.bgDrawnKey = '';
    this.requestRedraw();
  }

  public redraw(
    deltaTime: number,
    viewport: CanvasViewport,
    elements: DrawableElement[],
    editingElement: DrawableElement | null,
    toolSelected: ITool,
    screenPosition: Vector2,
    placementController: PlacementController,
    domOverlayHost: HTMLElement | null,
    selection: SelectionController,
    ruler: Ruler,
  ): boolean {
    const dpr = window.devicePixelRatio || 1;
    const logicalW = this.canvas.width / dpr;
    const logicalH = this.canvas.height / dpr;

    const zoom = viewport.zoom;
    const offset = viewport.offset;

    this.drawBackground(viewport);

    // Foreground canvas: element content + tool cursor
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.clearRect(0, 0, logicalW, logicalH);

    const tiles = this.inkTiles.beginFrame(
      elements,
      zoom,
      offset,
      dpr,
      this.canvas.width,
      this.canvas.height,
    );
    const drawOffset = tiles?.offset ?? offset;
    this.ctx.save();
    this.ctx.scale(zoom, zoom);
    this.ctx.translate(drawOffset.x, drawOffset.y);

    const viewRect = viewport.getWorldRect();
    const cullMargin = cullMarginWorld(zoom);
    const visibleElements: DrawableElement[] = [];
    let tilesDrawn = false;
    for (let index = 0; index < elements.length; index++) {
      const element = elements[index];
      if (!element.intersectsWorldRect(viewRect, cullMargin)) {
        continue;
      }
      visibleElements.push(element);
      if (tiles?.ready && index >= tiles.start && index < tiles.end) {
        if (!tilesDrawn) {
          this.inkTiles.blit(this.ctx);
          tilesDrawn = true;
        }
        continue;
      }
      element.draw(this.ctx, deltaTime);
    }
    // Cursor: compute fresh from screen position so it's correct even if
    // the user wheel-zoomed without moving the mouse since.
    const mouseWorld = viewport.screenToWorld(screenPosition);
    if (placementController.isActive) {
      placementController.drawGhost(this.ctx, mouseWorld);
    } else {
      toolSelected.drawCursor(this.ctx, mouseWorld);
    }
    this.ctx.restore();

    selection.advanceOverlay(deltaTime);
    const overlayHasContent = selection.hasOverlay || ruler.visible;
    if (
      this.overlayCtx &&
      this.overlayCanvas &&
      (overlayHasContent || this.overlayHasContent)
    ) {
      const overlayW = this.overlayCanvas.width / dpr;
      const overlayH = this.overlayCanvas.height / dpr;
      this.overlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.overlayCtx.clearRect(0, 0, overlayW, overlayH);
      this.overlayCtx.save();
      this.overlayCtx.scale(zoom, zoom);
      this.overlayCtx.translate(offset.x, offset.y);
      selection.drawOverlay(this.overlayCtx, editingElement, zoom);
      ruler.draw(this.overlayCtx, zoom);
      this.overlayCtx.restore();
      this.overlayHasContent = overlayHasContent;
    }

    if (domOverlayHost) {
      for (const element of elements) {
        element.syncDOM(viewport, domOverlayHost, visibleElements);
      }
      // DOM roots share canvas order with page-frame chrome, so keep both z-index and sibling order
      // in sync. `syncDOM` only appends on create, so only out-of-position nodes move.
      reorderDomOverlay(domOverlayHost, this.canvas, elements, visibleElements);
    }

    return selection.isOverlayAnimating || this.inkTiles.pending;
  }

  private drawBackground(viewport: CanvasViewport): void {
    const ctx = this.bgCtx;
    const canvas = this.bgCanvas;
    if (!ctx || !canvas) {
      return;
    }
    const { zoom, offset } = viewport;
    // Skipped when only content changed: an inking frame shouldn't redraw the whole background.
    const key = `${zoom} ${offset.x} ${offset.y} ${canvas.width} ${canvas.height}`;
    if (key === this.bgDrawnKey) {
      return;
    }
    this.bgDrawnKey = key;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.width / dpr;
    const height = canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const style = this.bgStyle;
    if (style.pattern === 'blank') {
      return;
    }
    if (style.pattern === 'image') {
      this.drawBackgroundImage(ctx, zoom, offset, width, height);
      return;
    }
    const color =
      style.patternColorMode === 'custom'
        ? style.patternColor
        : getCanvasPalette().grid;
    drawBackgroundPattern(
      ctx,
      style.pattern,
      color,
      viewport.getWorldRect(),
      zoom,
      offset,
    );
  }

  private drawBackgroundImage(
    ctx: CanvasRenderingContext2D,
    zoom: number,
    offset: Vector2,
    width: number,
    height: number,
  ): void {
    const tile = this.bgStyle.image;
    const image = this.bgImage;
    if (!tile || !image?.complete || image.naturalWidth === 0) {
      return;
    }
    this.bgImagePattern ??= ctx.createPattern(image, 'repeat');
    if (!this.bgImagePattern) {
      return;
    }
    this.bgImagePattern.setTransform(
      new DOMMatrix([
        (tile.width * zoom) / image.naturalWidth,
        0,
        0,
        (tile.height * zoom) / image.naturalHeight,
        offset.x * zoom,
        offset.y * zoom,
      ]),
    );
    ctx.fillStyle = this.bgImagePattern;
    ctx.fillRect(0, 0, width, height);
  }

  // DPR changes (e.g. moving the window between monitors) fire a window resize without
  // necessarily changing the element's CSS box, so the ResizeObserver alone misses them.
  public refreshSize(): void {
    this.syncSizeToContainer();
  }

  public destroy(): void {
    this.unsubBgPref?.();
    this.unsubBgPref = null;
    this.unsubTheme?.();
    this.unsubTheme = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.inkTiles.destroy();
  }

  // The canvas is stretched to its pane by CSS, so clientWidth/Height is the visible viewport
  // with the sidebar already excluded.
  private syncSizeToContainer(): void {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (width === 0 || height === 0) {
      return;
    }
    this.resizeCanvas(width, height);
    this.resizeOverlayCanvas(width, height);
    this.resizeBackgroundCanvas(width, height);
    // Resizing a canvas clears it.
    this.requestRedraw();
  }

  private resizeCanvas(width: number, height: number): void {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = width * dpr;
    this.canvas.height = height * dpr;
    // Assigning width/height resets context state; re-apply smoothing quality
    // so downscaled images (screenshots, photos) don't alias when zoomed out.
    this.ctx.imageSmoothingQuality = 'high';
  }

  private resizeOverlayCanvas(width: number, height: number): void {
    if (!this.overlayCanvas) {
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    this.overlayCanvas.width = width * dpr;
    this.overlayCanvas.height = height * dpr;
  }

  private resizeBackgroundCanvas(width: number, height: number): void {
    if (!this.bgCanvas || width === 0 || height === 0) {
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    this.bgCanvas.width = width * dpr;
    this.bgCanvas.height = height * dpr;
    this.bgDrawnKey = '';
  }
}

function drawBackgroundPattern(
  ctx: CanvasRenderingContext2D,
  pattern: 'grid' | 'dots' | 'lines',
  color: string,
  view: DOMRect,
  zoom: number,
  offset: Vector2,
): void {
  const { step, minorAlpha } = backgroundGridLevel(zoom);
  // Screen-constant below 100% zoom, so zoomed-out lines don't thin into nothing.
  const scale = Math.max(zoom, 1);
  // Dots sit mid-tile, lines on the tile edges.
  const phase = pattern === 'dots' ? BG_SPACING / 2 : 0;
  const first = (min: number) => Math.ceil((min - phase) / step);
  const last = (max: number) => Math.floor((max - phase) / step);
  const toScreenX = (n: number) => (n * step + phase + offset.x) * zoom;
  const toScreenY = (n: number) => (n * step + phase + offset.y) * zoom;
  const right = view.width * zoom;
  const bottom = view.height * zoom;
  const x0 = first(view.x);
  const x1 = last(view.x + view.width);
  const y0 = first(view.y);
  const y1 = last(view.y + view.height);

  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.5 * scale;
  const radius = 0.75 * scale;
  // Pass 0 draws the opaque even multiples, pass 1 the fading odd ones.
  for (const minor of [false, true]) {
    const alpha = minor ? minorAlpha : 1;
    if (alpha <= 0) {
      continue;
    }
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    if (pattern === 'dots') {
      for (let i = x0; i <= x1; i++) {
        for (let j = y0; j <= y1; j++) {
          if ((i % 2 !== 0 || j % 2 !== 0) !== minor) {
            continue;
          }
          const x = toScreenX(i);
          const y = toScreenY(j);
          ctx.moveTo(x + radius, y);
          ctx.arc(x, y, radius, 0, Math.PI * 2);
        }
      }
      ctx.fill();
      continue;
    }
    if (pattern === 'grid') {
      for (let i = x0; i <= x1; i++) {
        if ((i % 2 !== 0) === minor) {
          ctx.moveTo(toScreenX(i), 0);
          ctx.lineTo(toScreenX(i), bottom);
        }
      }
    }
    for (let j = y0; j <= y1; j++) {
      if ((j % 2 !== 0) === minor) {
        ctx.moveTo(0, toScreenY(j));
        ctx.lineTo(right, toScreenY(j));
      }
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

// DOM roots and page-frame chrome stack at `index + 1`, and the foreground canvas above all of them,
// except DOM elements that cover earlier canvas content, which stack above the canvas instead.
export function reorderDomOverlay(
  host: HTMLElement,
  canvas: HTMLElement,
  elements: readonly DrawableElement[],
  visibleElements: readonly DrawableElement[],
): void {
  const nodes = new Map<string, HTMLElement>();
  for (const child of host.children) {
    const node = child as HTMLElement;
    const uuid = node.dataset.elementUuid;
    if (uuid) {
      nodes.set(uuid, node);
    }
  }
  const canvasZIndex = String(elements.length + 1);
  if (canvas.style.zIndex !== canvasZIndex) {
    canvas.style.zIndex = canvasZIndex;
  }
  const aboveCanvas = domElementsAboveCanvas(visibleElements, nodes);
  let prev: HTMLElement | null = null;
  for (let index = 0; index < elements.length; index++) {
    const element = elements[index];
    const node = nodes.get(element.uuid);
    if (!node) {
      continue;
    }
    const zIndex = String(
      aboveCanvas.has(element.uuid) ? elements.length + 2 + index : index + 1,
    );
    if (node.style.zIndex !== zIndex) {
      node.style.zIndex = zIndex;
    }
    element.setDomZIndex(zIndex);
    const expected: Element | null = prev
      ? prev.nextElementSibling
      : host.firstElementChild;
    if (node !== expected) {
      host.insertBefore(node, expected);
    }
    prev = node;
  }
}

// One canvas paints all non-DOM content, so a DOM element with canvas content on both sides of it
// in the order can't be stacked exactly. It stays above, so earlier ink and images can't hide it.
// Backdrops never count: they're DOM, and the order keeps them below everything else.
function domElementsAboveCanvas(
  visibleElements: readonly DrawableElement[],
  domNodes: ReadonlyMap<string, HTMLElement>,
): Set<string> {
  const above = new Set<string>();
  const canvasContent: DrawableElement[] = [];
  for (const element of visibleElements) {
    if (element.hidden) {
      continue;
    }
    if (domNodes.has(element.uuid)) {
      const box = element.boundingBox;
      if (
        canvasContent.some((content) => content.intersectsWorldRect(box, 0))
      ) {
        above.add(element.uuid);
      }
    } else if (!isBackgroundElement(element.type)) {
      canvasContent.push(element);
    }
  }
  return above;
}
