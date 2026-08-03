import { getCanvasPalette, onCanvasThemeChange } from './canvas-theme';
import { type CanvasViewport, MAX_ZOOM } from './canvas-viewport';
import type { DrawableElement } from './elements/drawable-element';
import type { Vector2 } from './geometry';
import type { PlacementController } from './placement-controller';
import type { ITool } from './tools/tool';
import { UserPrefs } from './user-prefs';

type CanvasBackground = 'grid' | 'dots' | 'blank';

/** Side length of one background pattern tile, in world units. */
const BG_TILE_SIZE = 24;

/**
 * How far the background layer extends past the viewport on every side.
 *
 * A pan is applied to this layer as a translate of up to one tile, so the
 * layer has to already cover one tile beyond each edge or the translate would
 * drag a bare edge into view. One tile at maximum zoom bounds that for good,
 * which keeps the element's geometry a constant — nothing has to be re-laid-out
 * when the zoom changes.
 */
const BG_OVERDRAW_PX = BG_TILE_SIZE * MAX_ZOOM;

/**
 * The offset to translate the background layer by, given how far the view has
 * panned. The pattern repeats every tile, so shifting by a whole tile is
 * invisible and only the remainder has to be applied.
 */
export function backgroundPanShift(
  panScreenPx: number,
  tileScreenPx: number,
): number {
  if (!(tileScreenPx > 0) || !Number.isFinite(panScreenPx)) {
    return 0;
  }
  return ((panScreenPx % tileScreenPx) + tileScreenPx) % tileScreenPx;
}

/**
 * Paint one pattern tile and return it as a data URL.
 *
 * Rendered at `resolution` times its logical size so the dot stays crisp on a
 * retina display; the layer scales it back down through `background-size`.
 */
export function buildBackgroundTile(
  style: Exclude<CanvasBackground, 'blank'>,
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
    ctx.moveTo(BG_TILE_SIZE, 0);
    ctx.lineTo(BG_TILE_SIZE, BG_TILE_SIZE);
    ctx.moveTo(0, BG_TILE_SIZE);
    ctx.lineTo(BG_TILE_SIZE, BG_TILE_SIZE);
    ctx.stroke();
  }
  return tile.toDataURL();
}

/**
 * Owns the canvas layers (foreground content + cursor, selection overlay) and
 * the CSS-backed background layer, plus their RenderingContext-scoped concerns:
 * DPR math, sizing, and the per-frame clear/transform/draw passes. It reads
 * everything it needs from the canvas at `redraw()` time and never mutates it;
 * element ordering, selection, and placement lifecycle stay on DrawableCanvas.
 *
 * The background is a plain element with a repeating CSS background rather than
 * a third canvas. Measured on an iPad, filling one viewport with a
 * `CanvasPattern` cost roughly 8ms of a 24ms frame, and a third full-viewport
 * canvas is a third of the canvas memory that decides whether WebKit keeps 2D
 * contexts GPU-accelerated at all. As CSS, panning is a compositor translate
 * that repaints nothing, and only a zoom touches the layer's paint.
 */
export class CanvasRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly canvas: HTMLCanvasElement;
  private overlayCtx: CanvasRenderingContext2D | null = null;
  private overlayCanvas: HTMLCanvasElement | null = null;
  private bgHost: HTMLElement | null = null;
  private bgStyle: CanvasBackground;
  private unsubBgPref: (() => void) | null = null;
  private unsubTheme: (() => void) | null = null;
  private resizeObserver: ResizeObserver | null = null;

  /**
   * The view the background layer's CSS was last written for. The tile only
   * has to be re-sized when the zoom changes; a pan is a translate, and a run
   * of panned frames all measure against the same painted tiling.
   */
  private bgLastZoom = Number.NaN;
  private bgLastShiftX = Number.NaN;
  private bgLastShiftY = Number.NaN;

  public constructor(
    foregroundCtx: CanvasRenderingContext2D,
    foregroundCanvas: HTMLCanvasElement,
  ) {
    this.ctx = foregroundCtx;
    this.canvas = foregroundCanvas;
    this.syncSizeToContainer();
    this.bgStyle = UserPrefs.get('canvasBackground');
    this.unsubBgPref = UserPrefs.subscribe('canvasBackground', (bg) => {
      this.setBackgroundStyle(bg);
    });
    // Theme toggle changes the grid color, but the tile is cached — rebuild.
    this.unsubTheme = onCanvasThemeChange(() => {
      this.setBackgroundStyle(this.bgStyle);
    });
    // The canvas fills its pane, whose width changes when the sidebar is
    // toggled/resized or the pane is split — not only on window resize. Track
    // the element's own laid-out size so the viewport center stays correct.
    this.resizeObserver = new ResizeObserver(() => {
      this.syncSizeToContainer();
    });
    this.resizeObserver.observe(this.canvas);
  }

  /**
   * Adopt the element that shows the canvas background.
   *
   * Its geometry is written here rather than left to the host's stylesheet
   * because the overdraw is not a styling choice — it is what makes the pan
   * translate safe, and it belongs with the code that relies on it.
   */
  public setBackgroundHost(host: HTMLElement): void {
    this.bgHost = host;
    host.style.position = 'absolute';
    host.style.left = `${-BG_OVERDRAW_PX}px`;
    host.style.top = `${-BG_OVERDRAW_PX}px`;
    host.style.width = `calc(100% + ${BG_OVERDRAW_PX * 2}px)`;
    host.style.height = `calc(100% + ${BG_OVERDRAW_PX * 2}px)`;
    host.style.pointerEvents = 'none';
    host.style.backgroundRepeat = 'repeat';
    host.style.backgroundPosition = '0 0';
    // Promote the layer up front. Without this the per-frame transform can be
    // serviced by repainting the tiling instead of moving an existing texture,
    // which is the entire cost this layer exists to avoid — and the promotion
    // has to be standing, not decided on the first frame of a pan.
    host.style.willChange = 'transform';
    this.setBackgroundStyle(this.bgStyle);
  }

  public setOverlayCanvas(canvas: HTMLCanvasElement): void {
    this.overlayCanvas = canvas;
    this.overlayCtx = canvas.getContext('2d', { alpha: true });
    this.resizeOverlayCanvas(this.canvas.clientWidth, this.canvas.clientHeight);
  }

  /**
   * Swap the background pattern. Repaints the layer once; panning and zooming
   * afterwards reuse the tile.
   */
  public setBackgroundStyle(style: CanvasBackground): void {
    this.bgStyle = style;
    if (!this.bgHost) {
      return;
    }
    this.bgHost.style.backgroundImage =
      style === 'blank'
        ? 'none'
        : `url(${buildBackgroundTile(style, getCanvasPalette().grid, window.devicePixelRatio || 1)})`;
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
  ): void {
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

    for (const element of elements) {
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

    // Overlay canvas: selection outline + handles. Always above DOM chrome
    // so selection stays visible while a page frame is being edited (the
    // foreground canvas is lowered below chrome in that mode).
    if (this.overlayCtx && this.overlayCanvas) {
      const overlayW = this.overlayCanvas.width / dpr;
      const overlayH = this.overlayCanvas.height / dpr;
      this.overlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.overlayCtx.clearRect(0, 0, overlayW, overlayH);
      this.overlayCtx.save();
      this.overlayCtx.scale(zoom, zoom);
      this.overlayCtx.translate(offset.x, offset.y);
      for (const element of elements) {
        element.drawSelectionOverlay(
          this.overlayCtx,
          element === editingElement,
        );
      }
      this.overlayCtx.restore();
    }

    if (domOverlayHost) {
      for (const element of elements) {
        element.syncDOM(viewport, domOverlayHost);
      }
      // DOM overlay nodes share one layer, so among themselves they stack by
      // DOM order, not the element z-order. syncDOM only appends a node when it
      // first creates it, so a reorder (send backward/forward) never moves the
      // existing nodes. Reconcile the overlay's child order to `elements` so
      // overlapping DOM elements paint by z-order. Nodes move only when out of
      // position, so steady-state frames touch nothing and an already-correct
      // node (e.g. the focused editing textarea) is never re-inserted.
      reorderDomOverlay(domOverlayHost, elements);
    }
  }

  /**
   * Move the background layer to match the view.
   *
   * A pan is a translate of the already-painted tiling — no repaint, no
   * rasterization, no texture upload; the compositor moves an existing layer.
   * Only a zoom resizes the tiles, and that is the one case that repaints.
   * Styles are written only when the value they encode actually changed, since
   * assigning an identical string still dirties the element.
   */
  private syncBackground(zoom: number, offset: Vector2): void {
    const host = this.bgHost;
    if (!host) {
      return;
    }
    const tile = BG_TILE_SIZE * zoom;
    if (zoom !== this.bgLastZoom) {
      host.style.backgroundSize = `${tile}px ${tile}px`;
      this.bgLastZoom = zoom;
    }
    // The world origin sits at screen (offset * zoom), and the tiling is
    // anchored there. Reducing modulo the tile keeps the translate inside the
    // overdraw no matter how far the canvas has been panned.
    const shiftX = backgroundPanShift(offset.x * zoom, tile);
    const shiftY = backgroundPanShift(offset.y * zoom, tile);
    if (shiftX !== this.bgLastShiftX || shiftY !== this.bgLastShiftY) {
      host.style.transform = `translate3d(${shiftX}px, ${shiftY}px, 0)`;
      this.bgLastShiftX = shiftX;
      this.bgLastShiftY = shiftY;
    }
  }

  /**
   * Re-measure the container and resize all backing stores. Called on DPR
   * changes (e.g. moving the window between monitors), which fire a window
   * resize but may not change the element's CSS box, so the ResizeObserver
   * alone would miss them.
   */
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

  /**
   * Size every backing store to the foreground canvas's laid-out size. The
   * canvas is stretched to its pane by CSS (`inset-0`), so `clientWidth/Height`
   * is the visible viewport — the sidebar's width is already excluded. Both
   * canvas layers share the same container, so one measurement drives them
   * both; the background layer is sized in CSS and needs nothing here.
   */
  private syncSizeToContainer(): void {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (width === 0 || height === 0) {
      return;
    }
    this.resizeCanvas(width, height);
    this.resizeOverlayCanvas(width, height);
    // A DPR change arrives as a resize, and the tile is rasterized for a
    // specific DPR — rebuild it so it stays crisp on the new display.
    this.setBackgroundStyle(this.bgStyle);
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

/**
 * Order the DOM overlay's children to match the element z-order. Each DOM-backed
 * element tags its overlay node with `data-element-uuid`; walking `elements` in
 * order and inserting only out-of-position nodes yields the desired stacking
 * with the minimum number of DOM moves (none once orders agree).
 */
function reorderDomOverlay(
  host: HTMLElement,
  elements: DrawableElement[],
): void {
  const nodes = new Map<string, Element>();
  for (const child of host.children) {
    const uuid = (child as HTMLElement).dataset.elementUuid;
    if (uuid) {
      nodes.set(uuid, child);
    }
  }
  if (nodes.size < 2) {
    return;
  }

  let prev: Element | null = null;
  for (const element of elements) {
    const node = nodes.get(element.uuid);
    if (!node) {
      continue;
    }
    const expected: Element | null = prev
      ? prev.nextElementSibling
      : host.firstElementChild;
    if (node !== expected) {
      host.insertBefore(node, expected);
    }
    prev = node;
  }
}
