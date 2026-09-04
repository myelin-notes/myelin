import type { DrawableCanvas, Vector2 } from '../../drawable-canvas';
import type { YFieldMap } from '../../y-fields';
import { getPageFrame, resolveBandWorldPoint } from './resolve';

/**
 * Ties a canvas element to a `canvasBand` in a page frame's document, so it travels with the text
 * around it. The element's own geometry is untouched: only its offset is re-derived, every frame,
 * from wherever the band currently sits. Nothing is written back to Yjs until the anchor is
 * released — a per-frame write would flood peers and saves.
 */
export class PageAnchor {
  private _frameUuid = '';
  private _bandId = '';
  // World point the derived offset is measured against: `offset = bandWorldPoint - base`.
  private _baseX = 0;
  private _baseY = 0;

  public get active(): boolean {
    return this._frameUuid !== '' && this._bandId !== '';
  }

  public get frameUuid(): string {
    return this._frameUuid;
  }

  public get bandId(): string {
    return this._bandId;
  }

  public yProps(): Record<string, unknown> {
    return {
      anchorFrame: this._frameUuid,
      anchorBand: this._bandId,
      anchorBaseX: this._baseX,
      anchorBaseY: this._baseY,
    };
  }

  public yFields(): YFieldMap {
    return {
      anchorFrame: (v) => {
        this._frameUuid = typeof v === 'string' ? v : '';
      },
      anchorBand: (v) => {
        this._bandId = typeof v === 'string' ? v : '';
      },
      anchorBaseX: (v) => {
        this._baseX = typeof v === 'number' ? v : 0;
      },
      anchorBaseY: (v) => {
        this._baseY = typeof v === 'number' ? v : 0;
      },
    };
  }

  /** `bandWorld` and `offset` must both be read at the same instant, before any reflow. */
  public bind(
    frameUuid: string,
    bandId: string,
    bandWorld: Vector2,
    offset: Vector2,
  ): void {
    this._frameUuid = frameUuid;
    this._bandId = bandId;
    this._baseX = bandWorld.x - offset.x;
    this._baseY = bandWorld.y - offset.y;
  }

  public release(): void {
    this._frameUuid = '';
    this._bandId = '';
    this._baseX = 0;
    this._baseY = 0;
  }

  /** Offset the element should render at, or `null` while the band can't be measured. */
  public resolve(canvas: DrawableCanvas): Vector2 | null {
    if (!this.active) {
      return null;
    }
    const frame = getPageFrame(canvas, this._frameUuid);
    if (!frame) {
      return null;
    }
    const point = resolveBandWorldPoint(frame, this._bandId, canvas.viewport);
    return point === null
      ? null
      : { x: point.x - this._baseX, y: point.y - this._baseY };
  }
}
