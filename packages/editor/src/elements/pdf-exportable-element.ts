import type { PageFramePdfSource } from '../page-frame/page-frame-harvest';
import type { PdfElementExportSource } from '../pdf-element-export';
import type { DrawableElement } from './drawable-element';

export type CanvasPdfExportData =
  | {
      kind: 'page-frame';
      source: PageFramePdfSource | null;
      fallbackBounds: DOMRect;
    }
  | { kind: 'pdf'; source: PdfElementExportSource | null };

export interface PdfExportableElement {
  getCanvasPdfExportData(): CanvasPdfExportData;
}

export function getCanvasPdfExportData(
  element: DrawableElement,
): CanvasPdfExportData | null {
  const exportable = element as DrawableElement & Partial<PdfExportableElement>;
  return exportable.getCanvasPdfExportData?.() ?? null;
}
