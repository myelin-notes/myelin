/**
 * Context passed to a canvas element while harvesting it into the display list for the PDF-element
 * overlay. Elements emit native draw commands positioned in the current page's PDF-point space.
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
  /** Returns the index for a `{ custom }` font ref. Identical payloads are deduped. */
  addFontBase64(fontB64: string): number;
}

// Fonts repeat across every text element of the same family (unlike images), so entries are deduped.
export function createFontTable(fontsB64: string[]): (b64: string) => number {
  const indexByFont = new Map<string, number>();
  return (b64) => {
    let index = indexByFont.get(b64);
    if (index === undefined) {
      index = fontsB64.push(b64) - 1;
      indexByFont.set(b64, index);
    }
    return index;
  };
}
