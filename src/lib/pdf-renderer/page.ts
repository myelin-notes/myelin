import { Logger } from '@/lib/logger';
import type { PdfDocument } from './document';
import { injectPageFonts } from './fonts';
import { renderAnnotationLayer } from './layers/annotation-layer';
import { renderCanvasLayer } from './layers/canvas-layer';
import { renderTextLayer } from './layers/text-layer';
import { timed, timeEnd, timeStart } from './pdf-perf';
import type { RenderContext } from './types';

const logger = new Logger('PdfRendererPage');

function formatError(err: unknown): string {
  const e = err as { name?: string; message?: string; stack?: string } | null;
  return `${e?.name ?? 'Error'}: ${e?.message ?? String(err)}\n${e?.stack ?? ''}`;
}

async function runLayer<T extends Node>(
  name: string,
  pageIndex: number,
  fn: () => Promise<T>,
): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    logger.error(`Layer '${name}' failed`, {
      page: pageIndex + 1,
      error: formatError(err),
    });
    return null;
  }
}

export async function renderPage(
  doc: PdfDocument,
  pageIndex: number,
  scale = 1,
): Promise<HTMLElement> {
  const totalStart = timeStart();
  const page = await doc.getPage(pageIndex);
  const viewport = page.getViewport({ scale });
  const ctx: RenderContext = { page, viewport, scale };

  const wrapper = document.createElement('div');
  wrapper.className = 'pdf-page';
  wrapper.style.position = 'relative';
  wrapper.style.width = `${viewport.width}px`;
  wrapper.style.height = `${viewport.height}px`;
  wrapper.style.background = '#fff';
  wrapper.style.overflow = 'hidden';

  const opStart = timeStart();
  try {
    await page.getOperatorList();
  } catch (err) {
    logger.error('getOperatorList failed', {
      page: pageIndex + 1,
      error: formatError(err),
    });
    throw err;
  }
  timeEnd('renderPage.getOperatorList', opStart);

  const fontStart = timeStart();
  try {
    await injectPageFonts(doc, page);
  } catch (err) {
    logger.error('injectPageFonts failed', {
      page: pageIndex + 1,
      error: formatError(err),
    });
  }
  timeEnd('renderPage.injectFonts', fontStart);

  const [raster, text, annotations] = await Promise.all([
    timed('renderPage.canvas', () =>
      runLayer('canvas', pageIndex, () => renderCanvasLayer(ctx)),
    ),
    timed('renderPage.text', () =>
      runLayer('text', pageIndex, () => renderTextLayer(ctx)),
    ),
    timed('renderPage.annotations', () =>
      runLayer('annotations', pageIndex, () => renderAnnotationLayer(ctx)),
    ),
  ]);

  if (raster) {
    wrapper.appendChild(raster);
  }
  if (text) {
    wrapper.appendChild(text);
  }
  if (annotations) {
    wrapper.appendChild(annotations);
  }
  timeEnd('renderPage.total', totalStart);
  return wrapper;
}
