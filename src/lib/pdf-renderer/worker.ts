import './polyfill';
import { GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from './pdf-worker-entry.ts?worker&url';

let initialized = false;

export function ensureWorker(): void {
  if (initialized) {
    return;
  }
  // Use workerSrc (not workerPort) so pdf.js creates a fresh worker per
  // document. Sharing a single port through workerPort triggers
  // "PDFWorker.create - the worker is being destroyed" when switching PDFs.
  GlobalWorkerOptions.workerSrc = workerUrl;
  initialized = true;
}
