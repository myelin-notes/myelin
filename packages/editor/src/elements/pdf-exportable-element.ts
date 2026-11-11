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
  /** Readies lazily loaded content before export data is read; call the result when done. */
  loadContentForPdf?(): Promise<() => void>;
}

export function getCanvasPdfExportData(
  element: DrawableElement,
): CanvasPdfExportData | null {
  const exportable = element as DrawableElement & Partial<PdfExportableElement>;
  return exportable.getCanvasPdfExportData?.() ?? null;
}

export async function loadContentForPdf(
  elements: readonly DrawableElement[],
): Promise<() => void> {
  const releases = await Promise.all(
    elements.map((element) =>
      (
        element as DrawableElement & Partial<PdfExportableElement>
      ).loadContentForPdf?.(),
    ),
  );
  return () => {
    for (const release of releases) {
      release?.();
    }
  };
}
