import type { Vector2 } from './geometry';

type EditModePanAxis = 'vertical' | 'horizontal';

// Exported because the background layer sizes its overdraw from the largest tile MAX_ZOOM allows.
export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 5;

// A bare number is the width ratio; with both ratios given, the tighter one wins.
export type ViewFit = number | { widthRatio?: number; heightRatio?: number };

/** Handle to an in-flight RAF view transition. */
interface ViewAnimation {
  stop: () => void;
}

// WebKit reports a macOS trackpad pinch as these, never as ctrl+wheel. `scale` is cumulative
// from `gesturestart`.
interface WebKitGestureEvent extends UIEvent {
  scale: number;
  clientX: number;
  clientY: number;
}

/**
 * Camera state for the canvas. Pointer-drag panning lives in DrawableCanvas's pointer state
 * machine and calls `panBy()` here — deciding pan vs tool gesture is a scene concern, not a
 * camera one. Two-finger touch pan + pinch zoom is always active.
 */
export class CanvasViewport {
  private readonly canvas: HTMLCanvasElement;
  private _offset: Vector2 = { x: 0, y: 0 };
  private _zoom: number = 1;

  // Active pan/zoom transition (driven by requestAnimationFrame)
  private _viewAnim: ViewAnimation | null = null;

  // Wheel + touch are attached to the canvas's parent (not the canvas) so
  // they still fire during edit mode, when the canvas has pointer-events: none.
  private readonly _gestureTarget: HTMLElement;

  // Two-finger touch pan + pinch state
  private _touchPanLast: Vector2 | null = null;
  private _touchPinchLastDist: number | null = null;

  // iOS fires both streams for one pinch; the touch path owns it there, so gesture* stands down.
  private _touchPinching: boolean = false;
  private _gestureLastScale: number | null = null;

  private _onZoomChange?: (zoom: number) => void;
  private _viewListeners = new Set<() => void>();
  private _zoomLocked: boolean = false;
  private _contentBoundsProvider: (() => DOMRect | null) | null = null;
  private _touchSuppressedProvider: (() => boolean) | null = null;

  // Two-finger pinch zoom is unaffected. Toggled by DrawableCanvas on element edit enter/exit.
  public editMode: boolean = false;
  public editModePanAxis: EditModePanAxis = 'vertical';

  // Stored handlers for cleanup
  private readonly _handleWheel: (evt: WheelEvent) => void;
  private readonly _handleTouchStart: (evt: TouchEvent) => void;
  private readonly _handleTouchMove: (evt: TouchEvent) => void;
  private readonly _handleTouchEnd: (evt: TouchEvent) => void;
  private readonly _handleGestureStart: (evt: WebKitGestureEvent) => void;
  private readonly _handleGestureChange: (evt: WebKitGestureEvent) => void;
  private readonly _handleGestureEnd: (evt: WebKitGestureEvent) => void;

  public constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this._gestureTarget = canvas.parentElement ?? canvas;

    this._handleWheel = (evt) => this.handleWheel(evt);

    const touchDistance = (a: Touch, b: Touch): number => {
      const dx = a.clientX - b.clientX;
      const dy = a.clientY - b.clientY;
      return Math.hypot(dx, dy);
    };

    // Single-finger touch is left alone — DrawableCanvas pans the free canvas with one finger, and
    // in edit mode the contentEditable uses it for cursor placement / selection.
    this._handleTouchStart = (evt) => {
      // Before the suppression bail: gesture* must stand down for any two-finger touch, not just
      // the ones the camera acts on.
      this._touchPinching = evt.touches.length >= 2;
      // A hand resting on the screen while the stylus draws reads as a multi-touch blob, which would
      // pinch and pan the camera out from under the stroke.
      if (this._touchSuppressedProvider?.()) {
        this._touchPanLast = null;
        this._touchPinchLastDist = null;
        return;
      }
      if (evt.touches.length >= 2) {
        const t0 = evt.touches[0];
        const t1 = evt.touches[1];
        this._touchPanLast = {
          x: (t0.clientX + t1.clientX) / 2,
          y: (t0.clientY + t1.clientY) / 2,
        };
        this._touchPinchLastDist = touchDistance(t0, t1);
        evt.preventDefault();
      } else {
        this._touchPanLast = null;
        this._touchPinchLastDist = null;
      }
    };

    this._handleTouchMove = (evt) => {
      // Drop the anchors rather than just bail: fingers still down when suppression lifts would pan
      // by everything they travelled while the pen was on the page, snapping the camera.
      if (this._touchSuppressedProvider?.()) {
        this._touchPanLast = null;
        this._touchPinchLastDist = null;
        return;
      }
      if (evt.touches.length < 2) {
        return;
      }
      const t0 = evt.touches[0];
      const t1 = evt.touches[1];
      const avg = {
        x: (t0.clientX + t1.clientX) / 2,
        y: (t0.clientY + t1.clientY) / 2,
      };
      const dist = touchDistance(t0, t1);

      // Null anchors mean the gesture began under palm suppression. Re-anchoring here rather than
      // waiting for a fresh touchstart keeps the pinch from staying dead until the fingers lift and
      // land again; taking them from where the fingers are now avoids a jump by the travel banked.
      if (this._touchPanLast == null || this._touchPinchLastDist == null) {
        this._touchPanLast = avg;
        this._touchPinchLastDist = dist;
        evt.preventDefault();
        return;
      }
      evt.preventDefault();
      this.cancelAnimation();

      // On the free canvas, two-finger drag pans both axes; in edit mode,
      // lock pan to the edited element's page axis (consistent with wheel).
      const dx = avg.x - this._touchPanLast.x;
      const dy = avg.y - this._touchPanLast.y;
      if (!this.editMode || this.editModePanAxis === 'horizontal') {
        this._offset.x += dx / this._zoom;
      }
      if (!this.editMode || this.editModePanAxis === 'vertical') {
        this._offset.y += dy / this._zoom;
      }
      this._touchPanLast = avg;

      // Anchored on the midpoint between the fingers. zoomAroundPoint already fires notifyViewChange
      // (picking up the pan offset above), so only notify here when no pinch zoom ran.
      let zoomed = false;
      if (!this._zoomLocked && this._touchPinchLastDist > 0 && dist > 0) {
        this.zoomAroundPoint(
          this._zoom * (dist / this._touchPinchLastDist),
          this.getScreenPoint({ clientX: avg.x, clientY: avg.y }),
        );
        zoomed = true;
      }
      this._touchPinchLastDist = dist;
      if (!zoomed) {
        this.notifyViewChange();
      }
    };

    this._handleTouchEnd = (evt) => {
      if (evt.touches.length < 2) {
        this._touchPanLast = null;
        this._touchPinchLastDist = null;
        this._touchPinching = false;
      }
    };

    this._handleGestureStart = (evt) => {
      evt.preventDefault();
      if (this._touchPinching) {
        return;
      }
      this.cancelAnimation();
      this._gestureLastScale = evt.scale;
    };

    this._handleGestureChange = (evt) => {
      evt.preventDefault();
      if (this._gestureLastScale == null || this._zoomLocked) {
        return;
      }
      this.zoomAroundPoint(
        this._zoom * (evt.scale / this._gestureLastScale),
        this.getScreenPoint(evt),
      );
      this._gestureLastScale = evt.scale;
    };

    this._handleGestureEnd = (evt) => {
      evt.preventDefault();
      this._gestureLastScale = null;
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
    this._gestureTarget.addEventListener(
      'gesturestart',
      this._handleGestureStart as EventListener,
      { passive: false },
    );
    this._gestureTarget.addEventListener(
      'gesturechange',
      this._handleGestureChange as EventListener,
      { passive: false },
    );
    this._gestureTarget.addEventListener(
      'gestureend',
      this._handleGestureEnd as EventListener,
      { passive: false },
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
  public get zoomLocked(): boolean {
    return this._zoomLocked;
  }
  public setZoomLocked(locked: boolean): void {
    this._zoomLocked = locked;
  }

  // Clamps pan so content can go off-screen by a controlled amount but can't drift arbitrarily far
  // into empty space. Return `null` to disable clamping.
  public setContentBoundsProvider(
    provider: (() => DOMRect | null) | null,
  ): void {
    this._contentBoundsProvider = provider;
  }

  // Owned by DrawableCanvas, which is the side that sees the stylus: the camera has no pointer
  // state machine of its own to judge from.
  public setTouchSuppressedProvider(provider: (() => boolean) | null): void {
    this._touchSuppressedProvider = provider;
  }

  public setOnZoomChange(cb: (zoom: number) => void): void {
    this._onZoomChange = cb;
  }

  public onViewChange(listener: () => void): () => void {
    this._viewListeners.add(listener);
    return () => {
      this._viewListeners.delete(listener);
    };
  }

  private notifyViewChange(): void {
    if (!this._viewAnim) {
      this.clampOffsetToContent();
    }
    this.emitViewChange();
  }

  private emitViewChange(): void {
    for (const listener of this._viewListeners) {
      listener();
    }
  }

  public setEditMode(
    editMode: boolean,
    options: { panAxis?: EditModePanAxis } = {},
  ): void {
    const nextPanAxis = options.panAxis ?? 'vertical';
    if (this.editMode === editMode && this.editModePanAxis === nextPanAxis) {
      return;
    }
    this.editMode = editMode;
    this.editModePanAxis = nextPanAxis;
    this._touchPanLast = null;
    this._touchPinchLastDist = null;
  }

  public panBy(dx: number, dy: number): void {
    this._offset.x += dx;
    this._offset.y += dy;
    this.notifyViewChange();
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

  public getWorldRect(): DOMRect {
    const dpr = window.devicePixelRatio || 1;
    const screenW = this.canvas.width / dpr;
    const screenH = this.canvas.height / dpr;
    const tl = this.screenToWorld({ x: 0, y: 0 });
    return new DOMRect(tl.x, tl.y, screenW / this._zoom, screenH / this._zoom);
  }

  /** Pointer position in canvas-local screen pixels (origin = canvas top-left). */
  /**
   * Wheel → zoom (ctrl / trackpad pinch) or pan. Bound to the canvas' parent; DOM overlays that
   * live outside that subtree (the frame chrome layer) forward their wheel events here by hand,
   * from a non-passive listener so the preventDefault below still suppresses browser page zoom.
   */
  public handleWheel(evt: WheelEvent): void {
    this.cancelAnimation();
    // Stop the browser from scrolling any ancestor / contentEditable; the
    // viewport owns wheel-driven view changes regardless of edit mode.
    evt.preventDefault();
    if (evt.ctrlKey) {
      // Trackpad pinch (the browser sets ctrlKey) and ctrl+wheel. Anchored on the cursor.
      if (!this._zoomLocked) {
        // Exponential step: each notch multiplies zoom by a constant factor, so it feels equally
        // granular at any zoom level.
        this.zoomAroundPoint(
          this._zoom * Math.exp(evt.deltaY * -0.0025),
          this.getScreenPoint(evt),
        );
      }
    } else {
      // Two-finger scroll on trackpad / mouse wheel → pan.
      // In edit mode, lock wheel pan to the edited element's page axis.
      if (!this.editMode || this.editModePanAxis === 'horizontal') {
        this._offset.x -= evt.deltaX / this._zoom;
      }
      if (!this.editMode || this.editModePanAxis === 'vertical') {
        this._offset.y -= evt.deltaY / this._zoom;
      }
      this.notifyViewChange();
    }
  }

  public getScreenPoint(evt: { clientX: number; clientY: number }): Vector2 {
    const rect = this.canvas.getBoundingClientRect();
    return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
  }

  public getPoint(evt: { clientX: number; clientY: number }): Vector2 {
    return this.screenToWorld(this.getScreenPoint(evt));
  }

  // Shared by the animated and instant fit paths so both land on exactly the same view.
  private computeFit(
    worldRect: DOMRect,
    fit: ViewFit,
  ): {
    screenW: number;
    screenH: number;
    targetZoom: number;
    worldFocus: Vector2;
  } {
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

    return {
      screenW,
      screenH,
      targetZoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, unclampedTargetZoom)),
      worldFocus: {
        x: worldRect.x + worldRect.width / 2,
        y: worldRect.y + worldRect.height / 2,
      },
    };
  }

  /**
   * Instant twin of `animateViewToFitRect`, for placing the camera before the first paint.
   *
   * Deliberately skips `clampOffsetToContent`: framing a rect is an explicit instruction, and the
   * clamp exists to stop the *user* drifting into empty space. Honouring it would also make the
   * result depend on how much content exists yet.
   *
   * No-ops until the canvas has a real size; the caller retries once it does.
   */
  public setViewToFitRect(worldRect: DOMRect, fit: ViewFit = 0.8): void {
    this.cancelAnimation();
    const { screenW, screenH, targetZoom, worldFocus } = this.computeFit(
      worldRect,
      fit,
    );
    if (screenW < 1 || screenH < 1) {
      return;
    }
    this._zoom = targetZoom;
    this._offset = {
      x: screenW / 2 / targetZoom - worldFocus.x,
      y: screenH / 2 / targetZoom - worldFocus.y,
    };
    this._onZoomChange?.(this._zoom);
    this.emitViewChange();
  }

  // Lerps the SCREEN-SPACE position of the rect's center, not offset directly. Lerping offset
  // while zoom also changes makes any fixed world point trace a curved screen path — a wobble.
  public animateViewToFitRect(worldRect: DOMRect, fit: ViewFit = 0.8): void {
    const { screenW, screenH, targetZoom, worldFocus } = this.computeFit(
      worldRect,
      fit,
    );

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

    const durationMs = 700;
    const start = performance.now();
    let rafId = 0;
    const step = (now: number): void => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - (1 - t) ** 5; // ease-out quint
      const z = startZoom + (targetZoom - startZoom) * eased;
      const sx =
        startScreenFocus.x + (targetScreenFocus.x - startScreenFocus.x) * eased;
      const sy =
        startScreenFocus.y + (targetScreenFocus.y - startScreenFocus.y) * eased;
      this._zoom = z;
      this._offset = {
        x: sx / z - worldFocus.x,
        y: sy / z - worldFocus.y,
      };
      this._onZoomChange?.(this._zoom);
      this.notifyViewChange();
      if (t < 1) {
        rafId = requestAnimationFrame(step);
      } else {
        this._viewAnim = null;
      }
    };
    rafId = requestAnimationFrame(step);
    this._viewAnim = { stop: () => cancelAnimationFrame(rafId) };
  }

  public animateFitContent(): void {
    const bounds = this._contentBoundsProvider?.();
    if (bounds) {
      this.animateViewToFitRect(bounds, {
        widthRatio: 0.8,
        heightRatio: 0.8,
      });
    }
  }

  public zoomByFactor(factor: number): void {
    this.cancelAnimation();
    this.zoomAroundViewportCenter(this._zoom * factor);
  }

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
    this._gestureTarget.removeEventListener(
      'gesturestart',
      this._handleGestureStart as EventListener,
    );
    this._gestureTarget.removeEventListener(
      'gesturechange',
      this._handleGestureChange as EventListener,
    );
    this._gestureTarget.removeEventListener(
      'gestureend',
      this._handleGestureEnd as EventListener,
    );
  }

  // Clamps the viewport center to the content bounds inflated by ~3/4 viewport on each side —
  // enough slack to pan content fully off-screen, not enough to lose it. No provider / empty
  // content means no clamp, so fresh documents stay free.
  // Viewport center in world is `-offset + halfViewport`; constrain that, then solve for `offset`.
  private clampOffsetToContent(): void {
    const bounds = this._contentBoundsProvider?.();
    if (!bounds) {
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    const halfVW = this.canvas.width / dpr / this._zoom / 2;
    const halfVH = this.canvas.height / dpr / this._zoom / 2;
    const slackX = halfVW * 1.5;
    const slackY = halfVH * 1.5;
    this._offset.x = Math.min(
      halfVW - bounds.left + slackX,
      Math.max(halfVW - bounds.right - slackX, this._offset.x),
    );
    this._offset.y = Math.min(
      halfVH - bounds.top + slackY,
      Math.max(halfVH - bounds.bottom - slackY, this._offset.y),
    );
  }

  private zoomAroundPoint(targetZoom: number, screen: Vector2): void {
    const prevZoom = this._zoom;
    this._zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, targetZoom));

    const wxBefore = screen.x / prevZoom - this._offset.x;
    const wyBefore = screen.y / prevZoom - this._offset.y;
    const wxAfter = screen.x / this._zoom - this._offset.x;
    const wyAfter = screen.y / this._zoom - this._offset.y;

    this._offset.x += wxAfter - wxBefore;
    this._offset.y += wyAfter - wyBefore;

    this._onZoomChange?.(this._zoom);
    this.notifyViewChange();
  }

  private zoomAroundViewportCenter(targetZoom: number): void {
    const dpr = window.devicePixelRatio || 1;
    this.zoomAroundPoint(targetZoom, {
      x: this.canvas.width / dpr / 2,
      y: this.canvas.height / dpr / 2,
    });
  }
}
