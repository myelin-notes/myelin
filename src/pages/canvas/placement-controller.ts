import { getCanvasPalette } from './canvas-theme';
import type { PlacementGhost, Vector2 } from './drawable-canvas';

/**
 * Holds the one-shot placement ghost state — orthogonal to tools. When active,
 * the next primary-button click finalizes placement and the state clears. The
 * controller owns only the ghost and its Escape-key cleanup; the canvas drives
 * lifecycle (start/cancel) and supplies the click that finalizes placement.
 */
export class PlacementController {
  private _placement: PlacementGhost | null = null;
  private _placementCleanup: (() => void) | null = null;
  private onPlacementEnd?: () => void;

  public get isActive(): boolean {
    return this._placement !== null;
  }

  public get ghost(): PlacementGhost | null {
    return this._placement;
  }

  public setOnPlacementEnd(callback: (() => void) | undefined): void {
    this.onPlacementEnd = callback;
  }

  /**
   * Begin placement with `ghost`. Registers an Escape listener that cancels
   * placement. Caller is responsible for ending any prior placement first.
   */
  public start(ghost: PlacementGhost): void {
    this._placement = ghost;

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.end();
      }
    };
    document.addEventListener('keydown', handleKey);
    this._placementCleanup = () => {
      document.removeEventListener('keydown', handleKey);
    };
  }

  /**
   * Clear the ghost, remove its Escape listener, and fire the end callback.
   * Always clears `_placement` so the active state can never linger.
   */
  public end(): void {
    this._placement = null;
    this._placementCleanup?.();
    this._placementCleanup = null;
    this.onPlacementEnd?.();
  }

  /** Draw the placement ghost rectangle at the pointer's world position. */
  public drawGhost(ctx: CanvasRenderingContext2D, worldPos: Vector2): void {
    if (!this._placement) {
      return;
    }
    const b = this._placement.getBounds();
    const x = worldPos.x + b.x;
    const y = worldPos.y + b.y;

    const palette = getCanvasPalette();
    ctx.fillStyle = palette.selectionFill;
    ctx.beginPath();
    ctx.roundRect(x, y, b.width, b.height, 6);
    ctx.fill();

    ctx.strokeStyle = palette.selectionStroke;
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.roundRect(x, y, b.width, b.height, 6);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}
