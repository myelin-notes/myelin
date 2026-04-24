import { type AnimationPlaybackControls, animate } from 'motion';
import type { Vector2 } from './drawable-canvas';

/**
 * Camera state for the canvas: pan offset, zoom level, the wheel + touch
 * gestures that mutate them, and the animated view-fit transition.
 *
 * DrawableCanvas owns one of these and reads `offset` / `zoom` when rendering.
 * Pan-via-pointer-drag (space + drag, middle-click, single-finger touch
 * outside edit mode) lives in DrawableCanvas's pointer state machine and
 * calls `panBy()` here — deciding whether a pointerdown is a pan vs a tool
 * gesture is a scene-level concern, not a camera one.
 *
 * `editMode` is a hint set by DrawableCanvas when an element is being
 * inline-edited: it restricts wheel/trackpad pan to vertical only, and
 * enables two-finger touch pan + pinch zoom (single-finger touch is left
 * alone so the contentEditable can place the cursor / select text).
 */
export class CanvasViewport {
  private readonly canvas: HTMLCanvasElement;
  private _offset: Vector2 = { x: 0, y: 0 };
  private _zoom: number = 1;

  // Active pan/zoom transition (driven by motion's animate())
  private _viewAnim: AnimationPlaybackControls | null = null;

  // Wheel + touch are attached to the canvas's parent (not the canvas) so
  // they still fire during edit mode, when the canvas has pointer-events: none.
  private readonly _gestureTarget: HTMLElement;

  // Two-finger touch pan + pinch state
  private _touchPanLastY: number | null = null;
  private _touchPinchLastDist: number | null = null;

  private _onZoomChange?: (zoom: number) => void;

  /**
   * When true, plain wheel/touch pan is restricted to the vertical axis,
   * and two-finger touch gestures (pan + pinch zoom) are active. Toggled
   * by DrawableCanvas on element edit enter/exit.
   */
  public editMode: boolean = false;

  // Stored handlers for cleanup
  private readonly _handleWheel: (evt: WheelEvent) => void;
  private readonly _handleTouchStart: (evt: TouchEvent) => void;
  private readonly _handleTouchMove: (evt: TouchEvent) => void;
  private readonly _handleTouchEnd: (evt: TouchEvent) => void;

  public constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this._gestureTarget = canvas.parentElement ?? canvas;

    this._handleWheel = (evt) => {
      this.cancelAnimation();
      // Stop the browser from scrolling any ancestor / contentEditable; the
      // viewport owns wheel-driven view changes regardless of edit mode.
      evt.preventDefault();
      if (evt.ctrlKey) {
        // Pinch-to-zoom on trackpad (browser sets ctrlKey for pinch gestures).
        this.zoomAroundViewportCenter(this._zoom + evt.deltaY * -0.005);
      } else {
        // Two-finger scroll on trackpad / mouse wheel → pan.
        // In edit mode, restrict to vertical — page is centered horizontally
        // and there's nothing meaningful left/right.
        if (!this.editMode) {
          this._offset.x -= evt.deltaX / this._zoom;
        }
        this._offset.y -= evt.deltaY / this._zoom;
      }
    };

    const touchDistance = (a: Touch, b: Touch): number => {
      const dx = a.clientX - b.clientX;
      const dy = a.clientY - b.clientY;
      return Math.hypot(dx, dy);
    };

    // Two-finger touch in edit mode: vertical pan + pinch zoom.
    // Single-finger touch is left to the contentEditable for cursor
    // placement / selection.
    this._handleTouchStart = (evt) => {
      if (!this.editMode) {
        return;
      }
      if (evt.touches.length >= 2) {
        const t0 = evt.touches[0];
        const t1 = evt.touches[1];
        this._touchPanLastY = (t0.clientY + t1.clientY) / 2;
        this._touchPinchLastDist = touchDistance(t0, t1);
        evt.preventDefault();
      } else {
        this._touchPanLastY = null;
        this._touchPinchLastDist = null;
      }
    };

    this._handleTouchMove = (evt) => {
      if (!this.editMode) {
        return;
      }
      if (
        evt.touches.length < 2 ||
        this._touchPanLastY == null ||
        this._touchPinchLastDist == null
      ) {
        return;
      }
      evt.preventDefault();
      this.cancelAnimation();

      const t0 = evt.touches[0];
      const t1 = evt.touches[1];
      const avgY = (t0.clientY + t1.clientY) / 2;
      const dist = touchDistance(t0, t1);

      // Pan (vertical only).
      const dy = avgY - this._touchPanLastY;
      this._offset.y += dy / this._zoom;
      this._touchPanLastY = avgY;

      // Pinch zoom around viewport center (consistent with wheel).
      if (this._touchPinchLastDist > 0 && dist > 0) {
        this.zoomAroundViewportCenter(
          this._zoom * (dist / this._touchPinchLastDist),
        );
      }
      this._touchPinchLastDist = dist;
    };

    this._handleTouchEnd = (evt) => {
      if (evt.touches.length < 2) {
        this._touchPanLastY = null;
        this._touchPinchLastDist = null;
      }
    };

    this._gestureTarget.addEventListener(
      'wheel',
      this._handleWheel as EventListener,
      { passive: false },
    );
    this._gestureTarget.addEventListener(
      'touchstart',
      this._handleTouchStart as EventListener,
      { passive: false },
    );
    this._gestureTarget.addEventListener(
      'touchmove',
      this._handleTouchMove as EventListener,
      { passive: false },
    );
    this._gestureTarget.addEventListener(
      'touchend',
      this._handleTouchEnd as EventListener,
    );
  }

  public get offset(): Readonly<Vector2> {
    return this._offset;
  }
  public get zoom(): number {
    return this._zoom;
  }
  public get isAnimatingView(): boolean {
    return this._viewAnim !== null;
  }

  public setOnZoomChange(cb: (zoom: number) => void): void {
    this._onZoomChange = cb;
  }

  public panBy(dx: number, dy: number): void {
    this._offset.x += dx;
    this._offset.y += dy;
  }

  public worldToScreen(world: Vector2): Vector2 {
    return {
      x: (world.x + this._offset.x) * this._zoom,
      y: (world.y + this._offset.y) * this._zoom,
    };
  }

  public screenToWorld(screen: Vector2): Vector2 {
    return {
      x: screen.x / this._zoom - this._offset.x,
      y: screen.y / this._zoom - this._offset.y,
    };
  }

  public getPoint(evt: PointerEvent): Vector2 {
    return this.screenToWorld({ x: evt.pageX, y: evt.pageY });
  }

  /**
   * Animate pan & zoom so the given world-space rect is centered in the
   * viewport and fits the requested screen ratios.
   *
   * Lerps the SCREEN-SPACE position of the rect's center (not offset
   * directly) so the focal point traces a straight line on the screen.
   * Lerping offset linearly while zoom also changes makes any fixed world
   * point trace a curved screen-space path, which shows up as a wobble.
   */
  public animateViewToFitRect(
    worldRect: DOMRect,
    fit: number | { widthRatio?: number; heightRatio?: number } = 0.8,
  ): void {
    const dpr = window.devicePixelRatio || 1;
    const screenW = this.canvas.width / dpr;
    const screenH = this.canvas.height / dpr;
    const fitOptions = typeof fit === 'number' ? { widthRatio: fit } : fit;
    const targetZoomCandidates: number[] = [];

    if (fitOptions.widthRatio != null && worldRect.width > 0) {
      targetZoomCandidates.push(
        (fitOptions.widthRatio * screenW) / worldRect.width,
      );
    }
    if (fitOptions.heightRatio != null && worldRect.height > 0) {
      targetZoomCandidates.push(
        (fitOptions.heightRatio * screenH) / worldRect.height,
      );
    }

    const unclampedTargetZoom =
      targetZoomCandidates.length > 0
        ? Math.min(...targetZoomCandidates)
        : this._zoom;
    const targetZoom = Math.min(3, Math.max(0.2, unclampedTargetZoom));

    const worldFocus: Vector2 = {
      x: worldRect.x + worldRect.width / 2,
      y: worldRect.y + worldRect.height / 2,
    };

    const startScreenFocus: Vector2 = {
      x: (worldFocus.x + this._offset.x) * this._zoom,
      y: (worldFocus.y + this._offset.y) * this._zoom,
    };
    const targetScreenFocus: Vector2 = {
      x: screenW / 2,
      y: screenH / 2,
    };

    const startZoom = this._zoom;

    this.cancelAnimation();
    this._viewAnim = animate(0, 1, {
      duration: 0.7,
      ease: [0.22, 1, 0.36, 1], // ease-out quint
      onUpdate: (t) => {
        const z = startZoom + (targetZoom - startZoom) * t;
        const sx =
          startScreenFocus.x + (targetScreenFocus.x - startScreenFocus.x) * t;
        const sy =
          startScreenFocus.y + (targetScreenFocus.y - startScreenFocus.y) * t;
        this._zoom = z;
        this._offset = {
          x: sx / z - worldFocus.x,
          y: sy / z - worldFocus.y,
        };
        this._onZoomChange?.(this._zoom);
      },
      onComplete: () => {
        this._viewAnim = null;
      },
    });
  }

  /** Stop any in-flight view animation. */
  public cancelAnimation(): void {
    this._viewAnim?.stop();
    this._viewAnim = null;
  }

  public destroy(): void {
    this.cancelAnimation();
    this._gestureTarget.removeEventListener(
      'wheel',
      this._handleWheel as EventListener,
    );
    this._gestureTarget.removeEventListener(
      'touchstart',
      this._handleTouchStart as EventListener,
    );
    this._gestureTarget.removeEventListener(
      'touchmove',
      this._handleTouchMove as EventListener,
    );
    this._gestureTarget.removeEventListener(
      'touchend',
      this._handleTouchEnd as EventListener,
    );
  }

  /**
   * Set the zoom level, anchoring the world point currently at the canvas
   * center so it stays at the canvas center after the zoom.
   */
  private zoomAroundViewportCenter(targetZoom: number): void {
    const prevZoom = this._zoom;
    this._zoom = Math.min(3, Math.max(0.2, targetZoom));

    const dpr = window.devicePixelRatio || 1;
    const cx = this.canvas.width / dpr / 2;
    const cy = this.canvas.height / dpr / 2;

    const wxBefore = cx / prevZoom - this._offset.x;
    const wyBefore = cy / prevZoom - this._offset.y;
    const wxAfter = cx / this._zoom - this._offset.x;
    const wyAfter = cy / this._zoom - this._offset.y;

    this._offset.x += wxAfter - wxBefore;
    this._offset.y += wyAfter - wyBefore;

    this._onZoomChange?.(this._zoom);
  }
}
