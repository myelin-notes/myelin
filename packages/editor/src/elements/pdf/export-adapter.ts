import type { Vector2 } from '../../geometry';
import type { PdfElementExportSource } from '../../pdf-element-export';
import type { PdfDocumentModel } from './document-model';

export function createPdfExportSource(params: {
  uuid: string;
  model: PdfDocumentModel;
  offset: Vector2;
  scale: Vector2;
  boundingBox: DOMRect;
}): PdfElementExportSource | null {
  const bytes = params.model.bytes;
  if (!bytes) {
    return null;
  }
  return {
    uuid: params.uuid,
    pdfBytes: bytes,
    pages: params.model.layout.pages,
    offset: { x: params.offset.x, y: params.offset.y },
    scale: {
      x: getPositiveScale(params.scale.x),
      y: getPositiveScale(params.scale.y),
    },
    boundingBox: params.boundingBox,
  };
}

export function getPdfExportFileName(fileName: string): string {
  const trimmed = fileName.trim();
  if (!trimmed) {
    return 'document.pdf';
  }
  return trimmed.toLowerCase().endsWith('.pdf') ? trimmed : `${trimmed}.pdf`;
}

export function getPositiveScale(value: number): number {
  return Math.max(Math.abs(value), 0.001);
}
