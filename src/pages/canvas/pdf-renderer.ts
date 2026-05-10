import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';

export interface PdfPageSize {
  w: number;
  h: number;
}

export interface PdfPageOrderPdfEntry {
  kind: 'pdf';
  originalIndex: number;
}

export interface PdfPageOrderBlankEntry {
  kind: 'blank';
  size: PdfPageSize;
}

export type PdfPageOrderEntry = PdfPageOrderPdfEntry | PdfPageOrderBlankEntry;

export interface LoadedPdfDocument {
  document: PDFDocumentProxy;
  pageSizes: PdfPageSize[];
}

export interface PdfPageRenderHandle {
  promise: Promise<void>;
  cancel: () => void;
}

const MAX_RENDER_PIXELS = 16_000_000;
const MAX_RENDER_AXIS_PIXELS = 16_384;
const MAX_RENDER_SCALE = 4;
const MIN_RENDER_SCALE = 0.2;
const RENDER_SCALE_STEP = 0.25;
const RENDER_SCALE_SEARCH_STEPS = 32;

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

function getRenderDimensions(
  pageSize: PdfPageSize,
  scale: number,
): { w: number; h: number } {
  return {
    w: Math.max(1, Math.ceil(pageSize.w * scale)),
    h: Math.max(1, Math.ceil(pageSize.h * scale)),
  };
}

function isRenderScaleAllowed(pageSize: PdfPageSize, scale: number): boolean {
  const dimensions = getRenderDimensions(pageSize, scale);
  return (
    dimensions.w <= MAX_RENDER_AXIS_PIXELS &&
    dimensions.h <= MAX_RENDER_AXIS_PIXELS &&
    dimensions.w * dimensions.h <= MAX_RENDER_PIXELS
  );
}

function clampRenderScaleToCanvasLimits(
  pageSize: PdfPageSize,
  scale: number,
): number {
  if (isRenderScaleAllowed(pageSize, scale)) {
    return scale;
  }

  let low = Math.min(scale, 1 / Math.max(pageSize.w, pageSize.h));
  let high = scale;
  for (let i = 0; i < RENDER_SCALE_SEARCH_STEPS; i++) {
    const mid = (low + high) / 2;
    if (isRenderScaleAllowed(pageSize, mid)) {
      low = mid;
    } else {
      high = mid;
    }
  }

  return low;
}

export async function openPdfDocument(
  bytes: Uint8Array,
): Promise<PDFDocumentProxy> {
  const pdfjs = await getPdfJs();
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    verbosity: pdfjs.VerbosityLevel.ERRORS,
  });
  return loadingTask.promise;
}

export async function getPdfDocumentPageSizes(
  document: PDFDocumentProxy,
): Promise<PdfPageSize[]> {
  const pageSizes: PdfPageSize[] = [];
  for (let i = 1; i <= document.numPages; i++) {
    const page = await document.getPage(i);
    const viewport = page.getViewport({ scale: 1 });
    pageSizes.push({ w: viewport.width, h: viewport.height });
    page.cleanup();
  }
  return pageSizes;
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
  const count = Math.max(1, Math.floor(pageCount));
  return Array.from({ length: count }, (_, originalIndex) => ({
    kind: 'pdf',
    originalIndex,
  }));
}

export function normalizePdfPageOrder(
  value: unknown,
  pageCount: number,
  blankPageFallback: PdfPageSize = { w: 612, h: 792 },
  allowMissingPdfPages = false,
): PdfPageOrderEntry[] {
  const count = Math.max(1, Math.floor(pageCount));
  if (!Array.isArray(value)) {
    return createDefaultPdfPageOrder(count);
  }

  const entries = value.flatMap((entry): PdfPageOrderEntry[] => {
    if (typeof entry !== 'object' || entry === null || !('kind' in entry)) {
      return [];
    }

    const kind = (entry as { kind: unknown }).kind;
    if (kind === 'blank') {
      const sizeValue = (entry as { size?: unknown }).size;
      const size =
        typeof sizeValue === 'object' &&
        sizeValue !== null &&
        'w' in sizeValue &&
        'h' in sizeValue &&
        isFinitePositiveNumber((sizeValue as { w: unknown }).w) &&
        isFinitePositiveNumber((sizeValue as { h: unknown }).h)
          ? {
              w: (sizeValue as { w: number }).w,
              h: (sizeValue as { h: number }).h,
            }
          : null;
      return [
        {
          kind: 'blank',
          size: size ?? { ...blankPageFallback },
        },
      ];
    }

    if (kind !== 'pdf' || !('originalIndex' in entry)) {
      return [];
    }

    const originalIndex = (entry as { originalIndex: unknown }).originalIndex;
    if (
      typeof originalIndex !== 'number' ||
      !Number.isInteger(originalIndex) ||
      originalIndex < 0 ||
      originalIndex >= count
    ) {
      return [];
    }

    return [{ kind: 'pdf', originalIndex }];
  });

  const pdfEntries = entries.filter((entry) => entry.kind === 'pdf');
  if (
    (!allowMissingPdfPages && pdfEntries.length !== count) ||
    (allowMissingPdfPages && entries.length === 0)
  ) {
    return createDefaultPdfPageOrder(count);
  }

  const seen = new Set(pdfEntries.map((entry) => entry.originalIndex));
  const hasCompletePdfEntries = seen.size === count;
  const hasUniquePdfEntries = seen.size === pdfEntries.length;
  return allowMissingPdfPages
    ? hasUniquePdfEntries
      ? entries
      : createDefaultPdfPageOrder(count)
    : hasCompletePdfEntries
      ? entries
      : createDefaultPdfPageOrder(count);
}

export async function loadPdfDocument(
  bytes: Uint8Array,
): Promise<LoadedPdfDocument> {
  const document = await openPdfDocument(bytes);

  try {
    const pageSizes = await getPdfDocumentPageSizes(document);
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
  const maxScaleForSinglePixelAxis = Math.min(
    MAX_RENDER_AXIS_PIXELS / params.pageSize.w,
    MAX_RENDER_AXIS_PIXELS / params.pageSize.h,
  );
  const cappedScale = Math.min(
    Math.max(MIN_RENDER_SCALE, Math.min(desiredScale, MAX_RENDER_SCALE)),
    maxScaleForPixels,
    maxScaleForSinglePixelAxis,
  );

  return clampRenderScaleToCanvasLimits(params.pageSize, cappedScale);
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

    const baseViewport = page.getViewport({ scale: 1 });
    const renderScale = clampRenderScaleToCanvasLimits(
      { w: baseViewport.width, h: baseViewport.height },
      params.renderScale,
    );
    const viewport = page.getViewport({ scale: renderScale });
    const dimensions = getRenderDimensions(
      { w: baseViewport.width, h: baseViewport.height },
      renderScale,
    );
    params.canvas.width = dimensions.w;
    params.canvas.height = dimensions.h;

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
