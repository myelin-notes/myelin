import type { PDFPageProxy } from 'pdfjs-dist';

export type PageViewport = ReturnType<PDFPageProxy['getViewport']>;

export type PdfSource = string | URL | Uint8Array | ArrayBuffer;

export interface RenderContext {
  page: PDFPageProxy;
  viewport: PageViewport;
  scale: number;
}
