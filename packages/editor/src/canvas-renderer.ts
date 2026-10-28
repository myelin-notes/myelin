import type * as Y from 'yjs';
import {
  type CanvasStyle,
  getCanvasStyle,
  subscribeCanvasStyle,
} from './canvas-style';
import { getCanvasPalette, onCanvasThemeChange } from './canvas-theme';
import { type CanvasViewport, MAX_ZOOM } from './canvas-viewport';
import type { DrawableElement } from './elements/drawable-element';
import { isBackgroundElement } from './elements/element-type';
import { IS_MOBILE_BUILD } from './env';
import type { Vector2 } from './geometry';
import type { PlacementController } from './placement-controller';
import { quantizeRasterZoom } from './raster-zoom';
import type { Ruler } from './ruler';
import type { SelectionController } from './selection-controller';
import type { ITool } from './tools/tool';

/** Side length of one background pattern tile, in world units. */
const BG_TILE_SIZE = 24;

// Deliberately loose: strokes and glyphs paint outside their bounding box.
const CULL_MARGIN_PX = 128;

// Screen-constant, so zooming in doesn't drag a widening band of off-screen ink into frame.
export function cullMarginWorld(zoom: number): number {
  if (!(zoom > 0) || !Number.isFinite(zoom)) {
    return Number.POSITIVE_INFINITY;
  }
  return CULL_MARGIN_PX / zoom;
}

// WebKit re-rasters the tiled bg layer as its scale drifts mid-pinch: 40.4ms vs 19.3ms/frame
// on iPad. Frame count ignores a single wheel notch; settle window bridges two notches.
const BG_ZOOM_GESTURE_FRAMES = 3;
const BG_ZOOM_SETTLE_MS = 150;

export interface ZoomGestureState {
  lastZoom: number;
  changedAt: number;
  run: number;
}

export function createZoomGestureState(): ZoomGestureState {
  return { lastZoom: Number.NaN, changedAt: 0, run: 0 };
}

// Derived from the zoom value rather than viewport events: pinch, trackpad and animated
// zooms have three different starts and only one has an end event.
export function isZoomGestureActive(
  state: ZoomGestureState,
  zoom: number,
  now: number,
): boolean {
  if (zoom !== state.lastZoom) {
    state.lastZoom = zoom;
    state.changedAt = now;
    state.run += 1;
  } else if (now - state.changedAt >= BG_ZOOM_SETTLE_MS) {
    state.run = 0;
  }
  return state.run >= BG_ZOOM_GESTURE_FRAMES;
}

export function backgroundPanShift(
  panScreenPx: number,
  tileScreenPx: number,
): number {
  if (!(tileScreenPx > 0) || !Number.isFinite(panScreenPx)) {
    return 0;
  }
  return ((panScreenPx % tileScreenPx) + tileScreenPx) % tileScreenPx;
}

export function buildBackgroundTile(
  style: 'grid' | 'dots' | 'lines',
  color: string,
  resolution: number,
): string {
  const size = BG_TILE_SIZE * resolution;
  const tile = document.createElement('canvas');
  tile.width = size;
  tile.height = size;
  const ctx = tile.getContext('2d');
  if (!ctx) {
    return '';
  }
  ctx.scale(resolution, resolution);

  if (style === 'dots') {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(BG_TILE_SIZE / 2, BG_TILE_SIZE / 2, 0.75, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.strokeStyle = color;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    if (style === 'grid') {
      ctx.moveTo(BG_TILE_SIZE, 0);
      ctx.lineTo(BG_TILE_SIZE, BG_TILE_SIZE);
    }
    ctx.moveTo(0, BG_TILE_SIZE);
    ctx.lineTo(BG_TILE_SIZE, BG_TILE_SIZE);
    ctx.stroke();
  }
  return tile.toDataURL();
}

/**
 * The background is a CSS-backed element, not a third canvas. On iPad, filling one viewport
 * with a CanvasPattern cost ~8ms of a 24ms frame, and a third full-viewport canvas is a third
 * of the canvas memory that decides whether WebKit keeps 2D contexts GPU-accelerated at all.
 */
export class CanvasRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly canvas: HTMLCanvasElement;
  private overlayCtx: CanvasRenderingContext2D | null = null;
  private overlayCanvas: HTMLCanvasElement | null = null;
  private bgHost: HTMLElement | null = null;
  private bgStyle: CanvasStyle;
  private bgTileW = BG_TILE_SIZE;
  private bgTileH = BG_TILE_SIZE;
  // Pan translates this layer by up to one tile, so it must already cover one tile
  // past each edge. Sizing for max zoom keeps its geometry constant across zooms.
  private bgOverdraw = BG_TILE_SIZE * MAX_ZOOM;
  private unsubBgPref: (() => void) | null = null;
  private unsubTheme: (() => void) | null = null;
  private resizeObserver: ResizeObserver | null = null;

  // The tile only needs re-sizing when the zoom changes; a pan is a translate.
  private bgLastRasterZoom = Number.NaN;
  private bgLastTransform = '';

  /** The DPR the layer's tile was last written at; NaN until one has been. */
  private bgTileDpr = Number.NaN;

  /** Zoom-gesture tracking for the layer's takedown. @see BG_ZOOM_SETTLE_MS */
  private readonly bgZoomGesture = createZoomGestureState();
  private bgTakenDown = false;

  // clearRect invalidates a full-viewport layer as thoroughly as drawing does, so an
  // unconditional clear re-uploads it for a transparent frame. Half of ~11ms/frame on iPad.
  private overlayHasContent = false;

  public constructor(
    foregroundCtx: CanvasRenderingContext2D,
    foregroundCanvas: HTMLCanvasElement,
    private readonly requestRedraw: () => void,
    doc: Y.Doc,
  ) {
    this.ctx = foregroundCtx;
    this.canvas = foregroundCanvas;
    // Read before the sync below, which reaches setBackgroundStyle(this.bgStyle)
    // and would otherwise write the still-undefined value straight back.
    this.bgStyle = getCanvasStyle(doc);
    this.syncSizeToContainer();
    this.unsubBgPref = subscribeCanvasStyle(doc, () => {
      this.setBackgroundStyle(getCanvasStyle(doc));
    });
    // Theme toggle changes the grid color, but the tile is cached — rebuild.
    this.unsubTheme = onCanvasThemeChange(() => {
      this.setBackgroundStyle(this.bgStyle);
      // Adaptive ink resolves against the theme.
      this.requestRedraw();
    });
    // Pane width also changes on sidebar toggle/resize and pane splits, not just window resize.
    this.resizeObserver = new ResizeObserver(() => {
      this.syncSizeToContainer();
    });
    this.resizeObserver.observe(this.canvas);
  }

  // Geometry is written here rather than in the host stylesheet: the overdraw is what makes
  // the pan translate safe.
  public setBackgroundHost(host: HTMLElement): void {
    this.bgHost = host;
    host.style.position = 'absolute';
    this.writeBackgroundOverdraw(host);
    host.style.pointerEvents = 'none';
    host.style.backgroundRepeat = 'repeat';
    host.style.backgroundPosition = '0 0';
    // About the centre this would pull the left/top edges inward, and the overdraw only covers
    // the bottom-right growth of a scale that is never below 1.
    host.style.transformOrigin = '0 0';
    // Standing promotion. Decided on the first frame of a pan, the transform could be serviced
    // by repainting the tiling instead of moving an existing texture.
    host.style.willChange = 'transform';
    // A host adopted mid-takedown would otherwise stay hidden forever.
    host.style.display = '';
    this.bgTakenDown = false;
    // The memo describes the adopted element, not the view: a fresh host has
    // none of these styles, so forget them or the next sync skips writing them.
    this.bgLastRasterZoom = Number.NaN;
    this.bgLastTransform = '';
    this.setBackgroundStyle(this.bgStyle);
  }

  public setOverlayCanvas(canvas: HTMLCanvasElement): void {
    this.overlayCanvas = canvas;
    this.overlayCtx = canvas.getContext('2d', { alpha: true });
    this.resizeOverlayCanvas(this.canvas.clientWidth, this.canvas.clientHeight);
  }

  public setBackgroundStyle(style: CanvasStyle): void {
    this.bgStyle = style;
    const host = this.bgHost;
    if (!host) {
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    const { pattern, image } = style;
    if (pattern === 'image' && image) {
      host.style.backgroundImage = `url("${image.src}")`;
      this.setBackgroundTileSize(host, image.width, image.height);
    } else {
      const color =
        style.patternColorMode === 'custom'
          ? style.patternColor
          : getCanvasPalette().grid;
      host.style.backgroundImage =
        pattern === 'blank' || pattern === 'image'
          ? 'none'
          : `url(${buildBackgroundTile(pattern, color, dpr)})`;
      this.setBackgroundTileSize(host, BG_TILE_SIZE, BG_TILE_SIZE);
    }
    this.bgTileDpr = dpr;
  }

  private setBackgroundTileSize(
    host: HTMLElement,
    width: number,
    height: number,
  ): void {
    if (width === this.bgTileW && height === this.bgTileH) {
      return;
    }
    this.bgTileW = width;
    this.bgTileH = height;
    this.bgOverdraw = Math.max(width, height) * MAX_ZOOM;
    this.writeBackgroundOverdraw(host);
    this.bgLastRasterZoom = Number.NaN;
    this.bgLastTransform = '';
    this.requestRedraw();
  }

  private writeBackgroundOverdraw(host: HTMLElement): void {
    const overdraw = this.bgOverdraw;
    host.style.left = `${-overdraw}px`;
    host.style.top = `${-overdraw}px`;
    host.style.width = `calc(100% + ${overdraw * 2}px)`;
    host.style.height = `calc(100% + ${overdraw * 2}px)`;
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

    this.syncBackground(zoom, offset);

    // Foreground canvas: element content + tool cursor
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.clearRect(0, 0, logicalW, logicalH);

    this.ctx.save();
    this.ctx.scale(zoom, zoom);
    this.ctx.translate(offset.x, offset.y);

    const viewRect = viewport.getWorldRect();
    const cullMargin = cullMarginWorld(zoom);
    const visibleElements: DrawableElement[] = [];
    for (const element of elements) {
      if (!element.intersectsWorldRect(viewRect, cullMargin)) {
        continue;
      }
      visibleElements.push(element);
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

    // The background comes back only once a frame sees the zoom settle.
    return this.bgTakenDown || selection.isOverlayAnimating;
  }

  // A pan is a compositor translate of the already-painted tiling. Styles are written only when
  // their value changed, since assigning an identical string still dirties the element.
  // A zoom is the case this cannot win, so on tablets the layer leaves the tree. @see BG_ZOOM_SETTLE_MS
  private syncBackground(zoom: number, offset: Vector2): void {
    const host = this.bgHost;
    if (!host) {
      return;
    }

    const zooming =
      IS_MOBILE_BUILD &&
      isZoomGestureActive(this.bgZoomGesture, zoom, performance.now());
    if (zooming !== this.bgTakenDown) {
      host.style.display = zooming ? 'none' : '';
      this.bgTakenDown = zooming;
    }
    if (zooming) {
      // Nothing below would be visible, and writing it only dirties an element
      // that gets laid out again when the gesture ends.
      return;
    }

    const rasterZoom = quantizeRasterZoom(zoom);
    if (rasterZoom !== this.bgLastRasterZoom) {
      host.style.backgroundSize = `${this.bgTileW * rasterZoom}px ${this.bgTileH * rasterZoom}px`;
      this.bgLastRasterZoom = rasterZoom;
    }

    // The layer's top-left starts one overdraw before the world origin, which is a whole number
    // of tiles only at some zooms — so the overdraw is reduced along with the pan, or
    // the grid slides against the content as the zoom changes.
    const shiftX = backgroundPanShift(
      offset.x * zoom + this.bgOverdraw,
      this.bgTileW * zoom,
    );
    const shiftY = backgroundPanShift(
      offset.y * zoom + this.bgOverdraw,
      this.bgTileH * zoom,
    );
    // The translate is listed first, so it applies in screen pixels and the
    // scale after it does not multiply the pan shift.
    const transform = `translate3d(${shiftX}px, ${shiftY}px, 0) scale(${zoom / rasterZoom})`;
    if (transform !== this.bgLastTransform) {
      host.style.transform = transform;
      this.bgLastTransform = transform;
    }
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
  }

  // The canvas is stretched to its pane by CSS, so clientWidth/Height is the visible viewport
  // with the sidebar already excluded. The background layer is sized in CSS.
  private syncSizeToContainer(): void {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (width === 0 || height === 0) {
      return;
    }
    this.resizeCanvas(width, height);
    this.resizeOverlayCanvas(width, height);
    // Resizing a canvas clears it.
    this.requestRedraw();
    // Only on a DPR change: dragging the sidebar or a split divider fires a resize per frame, and
    // a rebuild encodes a PNG and repaints the whole overdrawn layer for an identical tile.
    if ((window.devicePixelRatio || 1) !== this.bgTileDpr) {
      this.setBackgroundStyle(this.bgStyle);
    }
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
