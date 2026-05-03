import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';

export interface PdfPageSize {
  w: number;
  h: number;
}

export interface PdfPageOrderEntry {
  kind: 'pdf';
  originalIndex: number;
}

export interface LoadedPdfDocument {
  document: PDFDocumentProxy;
  pageSizes: PdfPageSize[];
}

export interface PdfPageRenderHandle {
  promise: Promise<void>;
  cancel: () => void;
}

const MAX_RENDER_PIXELS = 16_000_000;
const MAX_RENDER_SCALE = 4;
const MIN_RENDER_SCALE = 0.2;
const RENDER_SCALE_STEP = 0.25;

let pdfJsPromise: Promise<
  typeof import('pdfjs-dist/legacy/build/pdf.mjs')
> | null = null;

function createRenderCancelledError(): Error {
  const error = new Error('PDF render cancelled');
  error.name = 'RenderingCancelledException';
  return error;
}

async function getPdfJs() {
  pdfJsPromise ??= import('pdfjs-dist/legacy/build/pdf.mjs').then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
    return pdfjs;
  });
  return pdfJsPromise;
}

function isFinitePositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function normalizePdfPageSizes(value: unknown): PdfPageSize[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (
      typeof entry !== 'object' ||
      entry === null ||
      !('w' in entry) ||
      !('h' in entry)
    ) {
      return [];
    }

    const w = (entry as { w: unknown }).w;
    const h = (entry as { h: unknown }).h;
    return isFinitePositiveNumber(w) && isFinitePositiveNumber(h)
      ? [{ w, h }]
      : [];
  });
}

export function createDefaultPdfPageOrder(
  pageCount: number,
): PdfPageOrderEntry[] {
  return Array.from({ length: pageCount }, (_, originalIndex) => ({
    kind: 'pdf',
    originalIndex,
  }));
}

export function normalizePdfPageOrder(
  value: unknown,
  pageCount: number,
): PdfPageOrderEntry[] {
  if (!Array.isArray(value)) {
    return createDefaultPdfPageOrder(pageCount);
  }

  const entries = value.flatMap((entry): PdfPageOrderEntry[] => {
    if (
      typeof entry !== 'object' ||
      entry === null ||
      !('kind' in entry) ||
      !('originalIndex' in entry)
    ) {
      return [];
    }

    const kind = (entry as { kind: unknown }).kind;
    const originalIndex = (entry as { originalIndex: unknown }).originalIndex;
    if (
      kind !== 'pdf' ||
      typeof originalIndex !== 'number' ||
      !Number.isInteger(originalIndex) ||
      originalIndex < 0 ||
      originalIndex >= pageCount
    ) {
      return [];
    }

    return [{ kind: 'pdf', originalIndex }];
  });

  return entries.length > 0 ? entries : createDefaultPdfPageOrder(pageCount);
}

export async function loadPdfDocument(
  bytes: Uint8Array,
): Promise<LoadedPdfDocument> {
  const pdfjs = await getPdfJs();
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(bytes) });
  const document = await loadingTask.promise;

  try {
    const pageSizes: PdfPageSize[] = [];
    for (let i = 1; i <= document.numPages; i++) {
      const page = await document.getPage(i);
      const viewport = page.getViewport({ scale: 1 });
      pageSizes.push({ w: viewport.width, h: viewport.height });
      page.cleanup();
    }

    return { document, pageSizes };
  } catch (error) {
    await document.destroy();
    throw error;
  }
}

export async function getPdfPageSizes(
  bytes: Uint8Array,
): Promise<PdfPageSize[]> {
  const loaded = await loadPdfDocument(bytes);
  await loaded.document.destroy();
  return loaded.pageSizes;
}

export function getPdfRenderScale(params: {
  pageSize: PdfPageSize;
  zoom: number;
  elementScale: number;
  dpr: number;
}): number {
  const desiredScale =
    Math.ceil(
      (params.zoom * params.elementScale * params.dpr) / RENDER_SCALE_STEP,
    ) * RENDER_SCALE_STEP;
  const maxScaleForPixels = Math.sqrt(
    MAX_RENDER_PIXELS / (params.pageSize.w * params.pageSize.h),
  );

  return Math.max(
    MIN_RENDER_SCALE,
    Math.min(desiredScale, maxScaleForPixels, MAX_RENDER_SCALE),
  );
}

export function renderPdfPageToCanvas(params: {
  document: PDFDocumentProxy;
  pageIndex: number;
  canvas: HTMLCanvasElement;
  renderScale: number;
}): PdfPageRenderHandle {
  let cancelled = false;
  let renderTask: RenderTask | null = null;

  const promise = (async () => {
    const page = await params.document.getPage(params.pageIndex + 1);
    if (cancelled) {
      page.cleanup();
      throw createRenderCancelledError();
    }

    const viewport = page.getViewport({ scale: params.renderScale });
    params.canvas.width = Math.max(1, Math.ceil(viewport.width));
    params.canvas.height = Math.max(1, Math.ceil(viewport.height));

    renderTask = page.render({
      canvas: params.canvas,
      viewport,
      background: 'rgb(255,255,255)',
    });
    try {
      await renderTask.promise;
    } finally {
      page.cleanup();
    }
  })();

  return {
    promise,
    cancel: () => {
      cancelled = true;
      renderTask?.cancel();
    },
  };
}

export function isPdfRenderCancelled(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name: unknown }).name === 'RenderingCancelledException'
  );
}
