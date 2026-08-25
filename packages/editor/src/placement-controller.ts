import { getCanvasPalette } from './canvas-theme';
import type { PlacementGhost, Vector2 } from './drawable-canvas';

/**
 * One-shot placement ghost state, orthogonal to tools: the next primary-button click finalizes
 * placement and clears the state. Owns only the ghost and its Escape-key cleanup; the canvas drives
 * start/cancel and supplies the finalizing click.
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

  // The caller must end any prior placement first.
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

  // Always clears `_placement`, so the active state can never linger.
  public end(): void {
    this._placement = null;
    this._placementCleanup?.();
    this._placementCleanup = null;
    this.onPlacementEnd?.();
  }

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
