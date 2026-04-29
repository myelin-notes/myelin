/** Maximum pixel dimension for a single tile. */
export const MAX_TILE_SIZE = 512;

/** A tile descriptor within a page's grid. */
export interface TileDescriptor {
  /** Unique key: "pageIndex-row-col". */
  key: string;
  row: number;
  col: number;
  /** Tile bounds in PDF-point space (origin = page top-left, Y down). */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TileGrid {
  cols: number;
  rows: number;
  /** Tile size in PDF points (last column/row may be smaller). */
  tileWidth: number;
  tileHeight: number;
  tiles: TileDescriptor[];
}

/** Page bounds in PDF points + the device-pixel scale to render at. */
export interface PageInputs {
  pageWidth: number;
  pageHeight: number;
  /** Device pixels per PDF point. */
  scale: number;
}

/** Viewport already transformed into one page's PDF-point space. */
export interface PageViewport {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function computeTileGrid(
  pageWidth: number,
  pageHeight: number,
  scale: number,
  pageIndex: number,
): TileGrid {
  if (scale <= 0) {
    return { cols: 0, rows: 0, tileWidth: 0, tileHeight: 0, tiles: [] };
  }
  // Each tile covers MAX_TILE_SIZE / scale PDF points. As scale rises, each
  // tile covers less of the page but still rasterizes to the same pixel
  // budget — bounding per-tile render cost.
  const tileWidth = MAX_TILE_SIZE / scale;
  const tileHeight = MAX_TILE_SIZE / scale;
  const cols = Math.ceil(pageWidth / tileWidth);
  const rows = Math.ceil(pageHeight / tileHeight);

  const tiles: TileDescriptor[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = col * tileWidth;
      const y = row * tileHeight;
      tiles.push({
        key: `${pageIndex}-${row}-${col}`,
        row,
        col,
        x,
        y,
        width: Math.min(tileWidth, pageWidth - x),
        height: Math.min(tileHeight, pageHeight - y),
      });
    }
  }
  return { cols, rows, tileWidth, tileHeight, tiles };
}

export function getVisibleTiles(
  grid: TileGrid,
  vx: number,
  vy: number,
  vw: number,
  vh: number,
): TileDescriptor[] {
  if (grid.cols === 0 || grid.rows === 0) {
    return [];
  }
  const firstCol = Math.max(0, Math.floor(vx / grid.tileWidth));
  const lastCol = Math.min(
    grid.cols - 1,
    Math.floor((vx + vw) / grid.tileWidth),
  );
  const firstRow = Math.max(0, Math.floor(vy / grid.tileHeight));
  const lastRow = Math.min(
    grid.rows - 1,
    Math.floor((vy + vh) / grid.tileHeight),
  );
  const out: TileDescriptor[] = [];
  for (let row = firstRow; row <= lastRow; row++) {
    for (let col = firstCol; col <= lastCol; col++) {
      out.push(grid.tiles[row * grid.cols + col]);
    }
  }
  return out;
}

/** Stable key for a visible-tile set. Same key = same coverage = skip work. */
export function computeBoundsKey(visible: TileDescriptor[]): string {
  return visible.length === 0
    ? 'empty'
    : `${visible[0].key}:${visible[visible.length - 1].key}`;
}

/** Tile nearest viewport center that satisfies `isAvailable`, else null. */
export function pickCenterMostAvailable(
  visible: TileDescriptor[],
  viewport: PageViewport,
  isAvailable: (tile: TileDescriptor) => boolean,
): TileDescriptor | null {
  const cx = viewport.x + viewport.width / 2;
  const cy = viewport.y + viewport.height / 2;
  let best: TileDescriptor | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const tile of visible) {
    if (!isAvailable(tile)) {
      continue;
    }
    const dx = tile.x + tile.width / 2 - cx;
    const dy = tile.y + tile.height / 2 - cy;
    const d = dx * dx + dy * dy;
    if (d < bestDist) {
      bestDist = d;
      best = tile;
    }
  }
  return best;
}
