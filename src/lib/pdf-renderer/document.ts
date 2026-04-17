import './polyfill';
import {
  getDocument,
  type PDFDocumentProxy,
  type PDFPageProxy,
} from 'pdfjs-dist';
import type { PdfSource } from './types';
import { ensureWorker } from './worker';

export class PdfDocument {
  private readonly proxy: PDFDocumentProxy;
  readonly numPages: number;
  readonly injectedFontIds = new Set<string>();

  constructor(proxy: PDFDocumentProxy) {
    this.proxy = proxy;
    this.numPages = proxy.numPages;
  }

  async getPage(pageIndex: number): Promise<PDFPageProxy> {
    // pdf.js is 1-indexed.
    return this.proxy.getPage(pageIndex + 1);
  }

  destroy(): void {
    this.proxy.destroy();
  }
}

export async function loadDocument(src: PdfSource): Promise<PdfDocument> {
  ensureWorker();
  // Copy the buffer: pdf.js transfers data.buffer to the worker on load,
  // detaching ours. Without copying, React StrictMode's double-invoke or
  // any retry would see a detached buffer → DataCloneError.
  let params: { data: Uint8Array } | { url: string | URL };
  if (src instanceof Uint8Array) {
    params = { data: new Uint8Array(src) };
  } else if (src instanceof ArrayBuffer) {
    params = { data: new Uint8Array(src.slice(0)) };
  } else {
    params = { url: src };
  }
  const loadingTask = getDocument(params);
  const proxy = await loadingTask.promise;
  return new PdfDocument(proxy);
}
