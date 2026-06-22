import { UserPrefs } from '@/lib/user-prefs';
import type { CanvasViewport } from './canvas-viewport';
import type { DrawableElement } from './elements/drawable-element';
import type { Vector2 } from './geometry';
import type { PlacementController } from './placement-controller';
import type { ITool } from './tools/tool';

type CanvasBackground = 'grid' | 'dots' | 'blank';

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
  private unsubBgPref: (() => void) | null = null;

  public constructor(
    foregroundCtx: CanvasRenderingContext2D,
    foregroundCanvas: HTMLCanvasElement,
  ) {
    this.ctx = foregroundCtx;
    this.canvas = foregroundCanvas;
    this.resizeCanvas(window.innerWidth, window.innerHeight);
    this.buildBgPattern(UserPrefs.get('canvasBackground'));
    this.unsubBgPref = UserPrefs.subscribe('canvasBackground', (bg) => {
      this.buildBgPattern(bg);
    });
  }

  public setBackgroundCanvas(canvas: HTMLCanvasElement): void {
    this.bgCanvas = canvas;
    this.bgCtx = canvas.getContext('2d', { alpha: true });
    this.resizeBgCanvas(window.innerWidth, window.innerHeight);
  }

  public setOverlayCanvas(canvas: HTMLCanvasElement): void {
    this.overlayCanvas = canvas;
    this.overlayCtx = canvas.getContext('2d', { alpha: true });
    this.resizeOverlayCanvas(window.innerWidth, window.innerHeight);
  }

  public buildBgPattern(style: CanvasBackground): void {
    if (style === 'blank') {
      this.bgPattern = null;
      return;
    }

    const spacing = 24;
    const tile = new OffscreenCanvas(spacing, spacing);
    const pctx = tile.getContext('2d')!;
    const color = 'rgba(164, 168, 172, 0.35)';

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
    const dpr = window.devicePixelRatio || 1;
    const logicalW = this.canvas.width / dpr;
    const logicalH = this.canvas.height / dpr;

    const zoom = viewport.zoom;
    const offset = viewport.offset;

    // Background canvas: dot grid + chrome (when not editing)
    if (this.bgCtx && this.bgCanvas) {
      const bgW = this.bgCanvas.width / dpr;
      const bgH = this.bgCanvas.height / dpr;
      this.bgCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.bgCtx.clearRect(0, 0, bgW, bgH);

      if (this.bgPattern) {
        this.bgCtx.save();
        this.bgCtx.scale(zoom, zoom);
        this.bgCtx.translate(offset.x, offset.y);
        this.bgCtx.fillStyle = this.bgPattern;
        this.bgCtx.fillRect(
          -offset.x - bgW / zoom,
          -offset.y - bgH / zoom,
          (bgW * 3) / zoom,
          (bgH * 3) / zoom,
        );
        this.bgCtx.restore();
      }
    }

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
    }
  }

  public handleWindowResize(width: number, height: number): void {
    this.resizeCanvas(width, height);
    this.resizeBgCanvas(width, height);
    this.resizeOverlayCanvas(width, height);
  }

  public destroy(): void {
    this.unsubBgPref?.();
    this.unsubBgPref = null;
  }

  private resizeCanvas(width: number, height: number): void {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = width * dpr;
    this.canvas.height = height * dpr;
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
  }

  private resizeBgCanvas(width: number, height: number): void {
    if (!this.bgCanvas) {
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    this.bgCanvas.width = width * dpr;
    this.bgCanvas.height = height * dpr;
    this.bgCanvas.style.width = `${width}px`;
    this.bgCanvas.style.height = `${height}px`;
  }

  private resizeOverlayCanvas(width: number, height: number): void {
    if (!this.overlayCanvas) {
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    this.overlayCanvas.width = width * dpr;
    this.overlayCanvas.height = height * dpr;
    this.overlayCanvas.style.width = `${width}px`;
    this.overlayCanvas.style.height = `${height}px`;
  }
}
