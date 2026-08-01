import { measureCanvasPerf } from './canvas-perf';
import { getCanvasPalette, onCanvasThemeChange } from './canvas-theme';
import type { CanvasViewport } from './canvas-viewport';
import type { DrawableElement } from './elements/drawable-element';
import type { Vector2 } from './geometry';
import type { PlacementController } from './placement-controller';
import type { ITool } from './tools/tool';
import { UserPrefs } from './user-prefs';

type CanvasBackground = 'grid' | 'dots' | 'blank';

/** Side length of one background pattern tile, in world units. */
const BG_TILE_SIZE = 24;

let maxDevicePixelRatio = Number.POSITIVE_INFINITY;

/**
 * Cap the backing-store scale of every canvas layer. Tablet builds set this at
 * bootstrap so an old iPad rasterizes far fewer pixels per layer per frame
 * (each layer is cleared and repainted every frame, so the saving is paid three
 * times over); desktop and the website leave it uncapped.
 *
 * Set it once, before any canvas mounts: `redraw` derives logical size from the
 * backing store using this same scale, so changing it mid-session would
 * mismatch a canvas sized under the old value until its next resize.
 */
export function setMaxDevicePixelRatio(max: number): void {
  maxDevicePixelRatio = max;
}

function renderScale(): number {
  return Math.min(window.devicePixelRatio || 1, maxDevicePixelRatio);
}

/**
 * Owns the three canvas layers (background grid/dots, foreground content +
 * cursor, selection overlay) and their RenderingContext-scoped concerns: DPR
 * math, sizing, and the per-frame clear/transform/draw passes. It reads
 * everything it needs from the canvas at `redraw()` time and never mutates it;
 * element ordering, selection, and placement lifecycle stay on DrawableCanvas.
 */
export class CanvasRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly canvas: HTMLCanvasElement;
  private bgCtx: CanvasRenderingContext2D | null = null;
  private bgCanvas: HTMLCanvasElement | null = null;
  private overlayCtx: CanvasRenderingContext2D | null = null;
  private overlayCanvas: HTMLCanvasElement | null = null;
  private bgPattern: CanvasPattern | null = null;
  private bgStyle: CanvasBackground;
  private unsubBgPref: (() => void) | null = null;
  private unsubTheme: (() => void) | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private readonly onInvalidate: () => void;

  /**
   * @param onInvalidate Called when something the renderer owns changes what
   * the next frame should look like (theme, background pref, a resize that
   * cleared the backing stores). Frames are only drawn when the canvas is
   * dirty, so without this those changes would not reach the screen.
   */
  public constructor(
    foregroundCtx: CanvasRenderingContext2D,
    foregroundCanvas: HTMLCanvasElement,
    onInvalidate: () => void = () => {},
  ) {
    this.ctx = foregroundCtx;
    this.canvas = foregroundCanvas;
    this.onInvalidate = onInvalidate;
    this.syncSizeToContainer();
    this.bgStyle = UserPrefs.get('canvasBackground');
    this.buildBgPattern(this.bgStyle);
    this.unsubBgPref = UserPrefs.subscribe('canvasBackground', (bg) => {
      this.buildBgPattern(bg);
      this.onInvalidate();
    });
    // Theme toggle changes the grid color, but the pattern is cached — rebuild.
    this.unsubTheme = onCanvasThemeChange(() => {
      this.buildBgPattern(this.bgStyle);
      this.onInvalidate();
    });
    // The canvas fills its pane, whose width changes when the sidebar is
    // toggled/resized or the pane is split — not only on window resize. Track
    // the element's own laid-out size so the viewport center stays correct.
    this.resizeObserver = new ResizeObserver(() => {
      this.syncSizeToContainer();
      this.onInvalidate();
    });
    this.resizeObserver.observe(this.canvas);
  }

  public setBackgroundCanvas(canvas: HTMLCanvasElement): void {
    this.bgCanvas = canvas;
    this.bgCtx = canvas.getContext('2d', { alpha: true });
    this.resizeBgCanvas(this.canvas.clientWidth, this.canvas.clientHeight);
  }

  public setOverlayCanvas(canvas: HTMLCanvasElement): void {
    this.overlayCanvas = canvas;
    this.overlayCtx = canvas.getContext('2d', { alpha: true });
    this.resizeOverlayCanvas(this.canvas.clientWidth, this.canvas.clientHeight);
  }

  public buildBgPattern(style: CanvasBackground): void {
    this.bgStyle = style;
    if (style === 'blank') {
      this.bgPattern = null;
      return;
    }

    const spacing = BG_TILE_SIZE;
    const tile = new OffscreenCanvas(spacing, spacing);
    const pctx = tile.getContext('2d')!;
    const color = getCanvasPalette().grid;

    if (style === 'dots') {
      pctx.fillStyle = color;
      pctx.beginPath();
      pctx.arc(spacing / 2, spacing / 2, 0.75, 0, Math.PI * 2);
      pctx.fill();
    } else {
      // grid
      pctx.strokeStyle = color;
      pctx.lineWidth = 0.5;
      pctx.beginPath();
      pctx.moveTo(spacing, 0);
      pctx.lineTo(spacing, spacing);
      pctx.moveTo(0, spacing);
      pctx.lineTo(spacing, spacing);
      pctx.stroke();
    }

    this.bgPattern = this.ctx.createPattern(tile, 'repeat');
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
    const dpr = renderScale();
    const logicalW = this.canvas.width / dpr;
    const logicalH = this.canvas.height / dpr;

    const zoom = viewport.zoom;
    const offset = viewport.offset;

    // Background canvas: dot grid + chrome (when not editing)
    measureCanvasPerf('bg', () => {
      if (!this.bgCtx || !this.bgCanvas) {
        return;
      }
      const bgW = this.bgCanvas.width / dpr;
      const bgH = this.bgCanvas.height / dpr;
      this.bgCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.bgCtx.clearRect(0, 0, bgW, bgH);

      if (this.bgPattern) {
        this.bgCtx.save();
        this.bgCtx.scale(zoom, zoom);
        this.bgCtx.translate(offset.x, offset.y);
        this.bgCtx.fillStyle = this.bgPattern;
        // Under this transform the visible viewport is exactly
        // (-offset, bg/zoom), and a 'repeat' pattern tiles to fill whatever
        // rect it is given — so fill just that, plus one tile of slack against
        // float error at the edges. Filling a 3x3 viewport block here (as this
        // once did) discarded 8/9 of the rasterized pixels every frame.
        this.bgCtx.fillRect(
          -offset.x - BG_TILE_SIZE,
          -offset.y - BG_TILE_SIZE,
          bgW / zoom + BG_TILE_SIZE * 2,
          bgH / zoom + BG_TILE_SIZE * 2,
        );
        this.bgCtx.restore();
      }
    });

    // Foreground canvas: element content + tool cursor
    measureCanvasPerf('fg', () => {
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
    });

    // Overlay canvas: selection outline + handles. Always above DOM chrome
    // so selection stays visible while a page frame is being edited (the
    // foreground canvas is lowered below chrome in that mode).
    measureCanvasPerf('overlay', () => {
      if (!this.overlayCtx || !this.overlayCanvas) {
        return;
      }
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
    });

    measureCanvasPerf('dom', () => {
      if (!domOverlayHost) {
        return;
      }
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
    });
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
   * is the visible viewport — the sidebar's width is already excluded. All
   * three layers share the same container, so one measurement drives them all.
   */
  private syncSizeToContainer(): void {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (width === 0 || height === 0) {
      return;
    }
    this.resizeCanvas(width, height);
    this.resizeBgCanvas(width, height);
    this.resizeOverlayCanvas(width, height);
  }

  private resizeCanvas(width: number, height: number): void {
    const dpr = renderScale();
    this.canvas.width = width * dpr;
    this.canvas.height = height * dpr;
    // Assigning width/height resets context state; re-apply smoothing quality
    // so downscaled images (screenshots, photos) don't alias when zoomed out.
    this.ctx.imageSmoothingQuality = 'high';
  }

  private resizeBgCanvas(width: number, height: number): void {
    if (!this.bgCanvas) {
      return;
    }
    const dpr = renderScale();
    this.bgCanvas.width = width * dpr;
    this.bgCanvas.height = height * dpr;
  }

  private resizeOverlayCanvas(width: number, height: number): void {
    if (!this.overlayCanvas) {
      return;
    }
    const dpr = renderScale();
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
