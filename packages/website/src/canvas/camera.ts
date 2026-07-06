import type { DrawableCanvas } from '@/pages/canvas/drawable-canvas';

interface Frame {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CameraState {
  zoom: number;
  cx: number;
  cy: number;
}

/** Fraction of each scroll segment spent resting on a region. */
const DWELL = 0.22;
const SMOOTHING = 7;
/** Progress movement that re-engages the camera after manual pan/zoom. */
const REENGAGE_DELTA = 0.04;
const EPSILON = 1e-3;

function smoothstep(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

/**
 * Drives the canvas viewport along the authored region path from the page's
 * scroll position. The camera holds each region for the middle of its scroll
 * segment and glides between them at the edges.
 *
 * The visitor stays in charge: pinch zoom or manual panning detaches the
 * camera, and it re-attaches once they scroll meaningfully again. While an
 * element is being edited the camera never moves.
 */
export class ScrollCamera {
  private raf = 0;
  private progress = 0;
  private lastApplied: { zoom: number; ox: number; oy: number } | null = null;
  private detached = false;
  private detachedAtProgress = 0;
  private reduceMotion = false;
  private lastTime = 0;

  // Cinematic opening: hold a wide shot of the whole notebook, then dive into
  // the first region. `introUntil` is the timestamp the intro finishes.
  private introUntil = 0;
  private introFrom: CameraState | null = null;
  private introTo: CameraState | null = null;
  private static readonly INTRO_MS = 1300;

  public onRegionChange?: (index: number) => void;
  private lastRegion = -1;

  constructor(
    private readonly dc: DrawableCanvas,
    private readonly canvas: HTMLCanvasElement,
    private readonly frames: Frame[],
  ) {}

  public start(): void {
    this.reduceMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    this.progress = this.scrollProgress();

    // At the top of the page, open on a wide shot and dive into region 0.
    if (!this.reduceMotion && this.progress < 0.02) {
      const target = this.cameraAt(0);
      this.introTo = target;
      this.introFrom = {
        zoom: target.zoom * 0.42,
        cx: target.cx + 260,
        cy: target.cy + 140,
      };
      this.applyCamera(this.introFrom);
      this.introUntil = performance.now() + ScrollCamera.INTRO_MS;
    } else {
      this.applyProgress(this.progress, true);
    }
    this.lastTime = performance.now();
    const tick = (time: number) => {
      const dt = Math.min(0.1, (time - this.lastTime) / 1000);
      this.lastTime = time;
      this.update(dt);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  public destroy(): void {
    cancelAnimationFrame(this.raf);
  }

  /** Scroll offset (px) that centers the camera on a region. */
  public scrollTopForRegion(index: number): number {
    const scrollable = Math.max(
      1,
      document.documentElement.scrollHeight - window.innerHeight,
    );
    return (index / (this.frames.length - 1)) * scrollable;
  }

  public regionIndex(): number {
    return Math.min(
      this.frames.length - 1,
      Math.max(0, Math.round(this.progress)),
    );
  }

  private scrollProgress(): number {
    const scrollable = Math.max(
      1,
      document.documentElement.scrollHeight - window.innerHeight,
    );
    const p = (window.scrollY / scrollable) * (this.frames.length - 1);
    return Math.min(this.frames.length - 1, Math.max(0, p));
  }

  private update(dt: number): void {
    // Cinematic intro owns the camera until it finishes (or the visitor
    // scrolls, which cancels it and hands control back to the scroll path).
    if (this.introUntil > 0) {
      const now = performance.now();
      const scrolled = this.scrollProgress() > 0.02;
      if (scrolled || now >= this.introUntil || !this.introFrom || !this.introTo) {
        this.introUntil = 0;
        this.introFrom = null;
        this.introTo = null;
        this.lastApplied = null;
      } else {
        const t = 1 - (this.introUntil - now) / ScrollCamera.INTRO_MS;
        const eased = smoothstep(t);
        this.applyCamera({
          zoom: Math.exp(
            Math.log(this.introFrom.zoom) +
              (Math.log(this.introTo.zoom) - Math.log(this.introFrom.zoom)) *
                eased,
          ),
          cx: this.introFrom.cx + (this.introTo.cx - this.introFrom.cx) * eased,
          cy: this.introFrom.cy + (this.introTo.cy - this.introFrom.cy) * eased,
        });
        return;
      }
    }

    const target = this.scrollProgress();

    if (this.detached) {
      if (Math.abs(target - this.detachedAtProgress) < REENGAGE_DELTA) {
        return;
      }
      this.detached = false;
      this.lastApplied = null;
    }

    // Never move the page under an open editor overlay.
    if (this.dc.editingElement) {
      this.lastApplied = null;
      return;
    }

    // A camera state that isn't the one we wrote means the visitor panned or
    // zoomed on their own; stop steering until they scroll again.
    if (this.lastApplied) {
      const vp = this.dc.viewport;
      if (
        Math.abs(vp.zoom - this.lastApplied.zoom) > EPSILON ||
        Math.abs(vp.offset.x - this.lastApplied.ox) > 0.5 ||
        Math.abs(vp.offset.y - this.lastApplied.oy) > 0.5
      ) {
        this.detached = true;
        this.detachedAtProgress = target;
        return;
      }
    }

    const factor = this.reduceMotion ? 1 : 1 - Math.exp(-SMOOTHING * dt);
    this.progress += (target - this.progress) * factor;
    if (Math.abs(target - this.progress) < 0.0005) {
      this.progress = target;
    }
    this.applyProgress(this.progress, false);

    const region = this.regionIndex();
    if (region !== this.lastRegion) {
      this.lastRegion = region;
      this.onRegionChange?.(region);
    }
  }

  private fitFrame(frame: Frame): CameraState {
    const vw = this.canvas.clientWidth || 1;
    const vh = this.canvas.clientHeight || 1;
    const zoom = Math.min(
      3,
      Math.max(0.2, Math.min((0.92 * vw) / frame.width, (0.86 * vh) / frame.height)),
    );
    return {
      zoom,
      cx: frame.x + frame.width / 2,
      cy: frame.y + frame.height / 2,
    };
  }

  private cameraAt(progress: number): CameraState {
    const i = Math.min(this.frames.length - 2, Math.floor(progress));
    const t = progress - i;
    const from = this.fitFrame(this.frames[i]);
    const to = this.fitFrame(this.frames[Math.min(i + 1, this.frames.length - 1)]);
    const eased = smoothstep((t - DWELL) / (1 - 2 * DWELL));
    return {
      zoom: Math.exp(
        Math.log(from.zoom) + (Math.log(to.zoom) - Math.log(from.zoom)) * eased,
      ),
      cx: from.cx + (to.cx - from.cx) * eased,
      cy: from.cy + (to.cy - from.cy) * eased,
    };
  }

  private applyProgress(progress: number, force: boolean): void {
    const cam = this.cameraAt(progress);
    const vp = this.dc.viewport;
    const vw = this.canvas.clientWidth || 1;
    const vh = this.canvas.clientHeight || 1;
    const targetOx = vw / (2 * cam.zoom) - cam.cx;
    const targetOy = vh / (2 * cam.zoom) - cam.cy;

    if (
      !force &&
      this.lastApplied &&
      Math.abs(cam.zoom - vp.zoom) < EPSILON &&
      Math.abs(targetOx - vp.offset.x) < 0.05 &&
      Math.abs(targetOy - vp.offset.y) < 0.05
    ) {
      return;
    }

    this.applyCamera(cam);
  }

  /** Point the viewport at a camera state (zoom + world center). */
  private applyCamera(cam: CameraState): void {
    const vp = this.dc.viewport;
    const vw = this.canvas.clientWidth || 1;
    const vh = this.canvas.clientHeight || 1;
    const targetOx = vw / (2 * cam.zoom) - cam.cx;
    const targetOy = vh / (2 * cam.zoom) - cam.cy;

    vp.cancelAnimation();
    if (Math.abs(cam.zoom - vp.zoom) > EPSILON) {
      vp.zoomByFactor(cam.zoom / vp.zoom);
    }
    vp.panBy(targetOx - vp.offset.x, targetOy - vp.offset.y);
    this.lastApplied = { zoom: vp.zoom, ox: vp.offset.x, oy: vp.offset.y };
  }
}
