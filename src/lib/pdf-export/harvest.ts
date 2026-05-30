/**
 * Context passed to a canvas element while harvesting it into the display list for
 * the PDF-element overlay. Elements emit native draw commands (text/path/image)
 * positioned in the current page's PDF-point space.
 */

import type { PageItem } from './contract';

export interface PdfHarvestContext {
  /** Map a world-space point to the current page's PDF-point space (top-left origin). */
  worldToPagePt(wx: number, wy: number): { x: number; y: number };
  /** PDF points per world unit on the Y axis — for converting font sizes. */
  ptPerWorldY: number;
  /** Emit a draw command on the current page. */
  push(item: PageItem): void;
  /** Register a base64-encoded PNG, returns its `imageRef` index. */
  addImageBase64(pngBase64: string): number;
}
