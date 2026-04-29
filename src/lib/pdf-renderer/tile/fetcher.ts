import { Logger } from '@/lib/logger';
import type { PdfDocument } from '../document';
import { renderCanvasLayer } from '../layers/canvas-layer';
import type { TileDescriptor } from './grid';

const logger = new Logger('TileFetcher');

/**
 * Render a single tile of a PDF page using the canvas-layer renderer with a
 * clip rect. Tile coords are in PDF-point space (origin = page top-left, Y
 * down — matches viewport.transform output rather than PDF user space).
 *
 * `scale` is device-pixels-per-PDF-point. The returned canvas has internal
 * dimensions of `tile.width × scale` × `tile.height × scale` and CSS size
 * matching the tile's PDF-point dimensions.
 */
export async function fetchTile(
  doc: PdfDocument,
  pageIndex: number,
  tile: TileDescriptor,
  scale: number,
): Promise<HTMLCanvasElement | undefined> {
  try {
    const page = await doc.getPage(pageIndex);
    const viewport = page.getViewport({ scale: 1 });
    const ctx = { page, viewport, scale: 1 };
    const dpr = window.devicePixelRatio || 1;
    const renderScale = scale / dpr;
    const canvas = await renderCanvasLayer(ctx, renderScale, {
      x: tile.x,
      y: tile.y,
      width: tile.width,
      height: tile.height,
    });
    canvas.classList.add('pdf-tile');
    return canvas;
  } catch (err) {
    logger.error('Tile fetch failed', err, { pageIndex, tileKey: tile.key });
    return undefined;
  }
}
