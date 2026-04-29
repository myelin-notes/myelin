import type { PageInputs, TileDescriptor } from './grid';
import { type RenderedTile, TilePageState } from './page-state';

export type { PageInputs, RenderedTile };

export interface ViewportInfo {
  /** Per-page viewport rect in PDF-point space. Returns null if offscreen. */
  pageViewport(pageIndex: number): {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
}

export type ViewportSource = () => ViewportInfo | null;

export type TileFetcher = (
  pageIndex: number,
  rect: TileDescriptor,
  scale: number,
) => Promise<HTMLCanvasElement | undefined>;

const MAX_IN_FLIGHT = 2;
const ZOOM_QUIET_MS = 200;

/**
 * Coordinates tile rendering: bounded pipeline, per-page caches, shared
 * viewport, session-scoped invalidation on scale change. Stale tiles bridge
 * the visual until new-scale tiles populate.
 */
export class TileManager {
  private readonly fetchTile: TileFetcher;
  private readonly pages = new Map<number, TilePageState>();
  private viewportSource: ViewportSource | null = null;
  private inFlight = 0;
  private readonly inFlightIds = new Set<string>();
  private session = 0;
  private sessionScale = 0;
  private zooming = false;
  private zoomEndTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  constructor(fetchTile: TileFetcher) {
    this.fetchTile = fetchTile;
  }

  setPageInputs(pageIndex: number, inputs: PageInputs): void {
    if (this.destroyed) {
      return;
    }
    const page = this.ensurePage(pageIndex);
    const scaleChanged = page.setInputs(inputs);
    if (scaleChanged && this.sessionScale !== inputs.scale) {
      this.session++;
      this.sessionScale = inputs.scale;
      this.startZoomQuietTimer();
    }
    this.process();
  }

  removePage(pageIndex: number): void {
    const page = this.pages.get(pageIndex);
    if (!page) {
      return;
    }
    page.clear();
    this.pages.delete(pageIndex);
  }

  setOnPageSnapshotChange(
    pageIndex: number,
    callback: (() => void) | null,
  ): void {
    this.ensurePage(pageIndex).setOnSnapshotChange(callback);
  }

  getPageTiles(pageIndex: number): RenderedTile[] {
    return this.pages.get(pageIndex)?.getSnapshot() ?? [];
  }

  setViewportSource(source: ViewportSource | null): void {
    this.viewportSource = source;
    this.process();
  }

  refresh(): void {
    this.process();
  }

  destroy(): void {
    this.destroyed = true;
    this.session++;
    this.inFlight = 0;
    this.inFlightIds.clear();
    if (this.zoomEndTimer !== null) {
      clearTimeout(this.zoomEndTimer);
      this.zoomEndTimer = null;
    }
    this.zooming = false;
    for (const page of this.pages.values()) {
      page.clear();
    }
    this.pages.clear();
    this.viewportSource = null;
  }

  private ensurePage(pageIndex: number): TilePageState {
    let page = this.pages.get(pageIndex);
    if (!page) {
      page = new TilePageState();
      this.pages.set(pageIndex, page);
    }
    return page;
  }

  private startZoomQuietTimer(): void {
    this.zooming = true;
    if (this.zoomEndTimer !== null) {
      clearTimeout(this.zoomEndTimer);
    }
    this.zoomEndTimer = setTimeout(() => {
      this.zoomEndTimer = null;
      this.zooming = false;
      this.process();
    }, ZOOM_QUIET_MS);
  }

  private process(): void {
    if (this.destroyed || this.zooming) {
      return;
    }
    const viewport = this.viewportSource?.();
    if (!viewport) {
      return;
    }
    while (this.inFlight < MAX_IN_FLIGHT) {
      if (!this.pickAndFetch(viewport)) {
        return;
      }
    }
  }

  private pickAndFetch(viewport: ViewportInfo): boolean {
    for (const [pageIndex, page] of this.pages) {
      if (page.inputs.scale <= 0) {
        continue;
      }
      const pv = viewport.pageViewport(pageIndex);
      if (!pv) {
        continue;
      }
      const session = this.session;
      const candidate = page.pickNextTile(pageIndex, pv, (key) =>
        this.inFlightIds.has(`${session}:${key}`),
      );
      if (candidate) {
        this.startFetch(pageIndex, candidate, page.inputs.scale);
        return true;
      }
    }
    return false;
  }

  private async startFetch(
    pageIndex: number,
    tile: TileDescriptor,
    scale: number,
  ): Promise<void> {
    const session = this.session;
    const id = `${session}:${tile.key}`;
    this.inFlight++;
    this.inFlightIds.add(id);
    let madeProgress = false;
    try {
      const canvas = await this.fetchTile(pageIndex, tile, scale);
      if (session !== this.session || this.destroyed || !canvas) {
        return;
      }
      const page = this.pages.get(pageIndex);
      if (!page) {
        return;
      }
      page.acceptTile(tile, canvas);
      madeProgress = true;
    } finally {
      this.inFlight--;
      this.inFlightIds.delete(id);
      if (!this.destroyed && (madeProgress || session !== this.session)) {
        this.process();
      }
    }
  }
}
