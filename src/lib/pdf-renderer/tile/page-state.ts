import {
  computeBoundsKey,
  computeTileGrid,
  getVisibleTiles,
  type PageInputs,
  type PageViewport,
  pickCenterMostAvailable,
  type TileDescriptor,
  type TileGrid,
} from './grid';

export interface RenderedTile {
  descriptor: TileDescriptor;
  canvas: HTMLCanvasElement;
}

const EMPTY: RenderedTile[] = [];

const INITIAL_INPUTS: PageInputs = {
  pageWidth: 0,
  pageHeight: 0,
  scale: 0,
};

/**
 * One page's tile cache plus a stale bridge: when the rendering scale changes,
 * existing tiles are demoted to "stale" and remain visible at their original
 * percent-of-page positions while new-scale tiles populate, then released.
 */
export class TilePageState {
  inputs: PageInputs = INITIAL_INPUTS;
  private cache = new Map<string, RenderedTile>();
  private staleTiles: RenderedTile[] = [];
  private snapshot: RenderedTile[] = EMPTY;
  private lastBoundsKey = '';
  private grid: TileGrid | null = null;
  private staleGen = 0;
  private onSnapshotChange: (() => void) | null = null;

  setOnSnapshotChange(cb: (() => void) | null): void {
    this.onSnapshotChange = cb;
  }

  /** Returns true if scale changed (caller should bump session). */
  setInputs(inputs: PageInputs): boolean {
    const prev = this.inputs;
    const scaleChanged = prev.scale !== inputs.scale;
    const gridInvalid =
      prev.pageWidth !== inputs.pageWidth ||
      prev.pageHeight !== inputs.pageHeight ||
      scaleChanged;
    this.inputs = inputs;
    if (gridInvalid) {
      this.grid = null;
    }
    if (scaleChanged) {
      this.lastBoundsKey = '';
      this.demoteCacheToStale();
      this.publishSnapshot();
    }
    return scaleChanged;
  }

  getSnapshot(): RenderedTile[] {
    return this.snapshot;
  }

  /**
   * Reconcile cache against viewport, evict stale-relative-to-coverage tiles,
   * return next tile to fetch (or null if all visible cached / in flight).
   */
  pickNextTile(
    pageIndex: number,
    viewport: PageViewport,
    isInFlight: (tileKey: string) => boolean,
  ): TileDescriptor | null {
    if (!this.grid) {
      this.grid = computeTileGrid(
        this.inputs.pageWidth,
        this.inputs.pageHeight,
        this.inputs.scale,
        pageIndex,
      );
    }
    const visible = getVisibleTiles(
      this.grid,
      viewport.x,
      viewport.y,
      viewport.width,
      viewport.height,
    );

    const boundsKey = computeBoundsKey(visible);
    let allVisibleCached = visible.length > 0;
    for (const tile of visible) {
      if (!this.cache.has(tile.key)) {
        allVisibleCached = false;
        break;
      }
    }
    if (allVisibleCached && this.staleTiles.length > 0) {
      this.releaseStaleTiles();
      this.publishSnapshot();
    }
    if (boundsKey === this.lastBoundsKey && allVisibleCached) {
      return null;
    }
    this.lastBoundsKey = boundsKey;

    const visibleKeys = new Set(visible.map((t) => t.key));
    let evicted = false;
    for (const [key] of this.cache) {
      if (!visibleKeys.has(key)) {
        this.cache.delete(key);
        evicted = true;
      }
    }
    if (evicted) {
      this.publishSnapshot();
    }

    return pickCenterMostAvailable(
      visible,
      viewport,
      (t) => !(this.cache.has(t.key) || isInFlight(t.key)),
    );
  }

  acceptTile(tile: TileDescriptor, canvas: HTMLCanvasElement): void {
    this.cache.set(tile.key, { descriptor: tile, canvas });
    this.publishSnapshot();
  }

  clear(): void {
    if (
      this.cache.size === 0 &&
      this.staleTiles.length === 0 &&
      this.snapshot === EMPTY
    ) {
      return;
    }
    this.cache.clear();
    this.staleTiles = [];
    this.snapshot = EMPTY;
    this.lastBoundsKey = '';
    this.onSnapshotChange?.();
  }

  private demoteCacheToStale(): void {
    if (this.cache.size === 0) {
      return;
    }
    const gen = ++this.staleGen;
    this.staleTiles = Array.from(this.cache.values(), (tile) => ({
      canvas: tile.canvas,
      descriptor: {
        ...tile.descriptor,
        key: `stale-${gen}:${tile.descriptor.key}`,
      },
    }));
    this.cache.clear();
  }

  private releaseStaleTiles(): void {
    this.staleTiles = [];
  }

  // Stale first → new tiles render on top.
  private publishSnapshot(): void {
    this.snapshot =
      this.staleTiles.length > 0
        ? [...this.staleTiles, ...this.cache.values()]
        : Array.from(this.cache.values());
    this.onSnapshotChange?.();
  }
}
