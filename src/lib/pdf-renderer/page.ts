import { Logger } from '@/lib/logger';
import type { PdfDocument } from './document';
import { injectPageFonts } from './fonts';
import { renderAnnotationLayer } from './layers/annotation-layer';
import { renderImageLayer } from './layers/image-layer';
import { renderPathLayer } from './layers/path-layer';
import { renderTextLayer } from './layers/text-layer';
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

  try {
    await page.getOperatorList();
  } catch (err) {
    logger.error('getOperatorList failed', {
      page: pageIndex + 1,
      error: formatError(err),
    });
    throw err;
  }
  try {
    await injectPageFonts(doc, page);
  } catch (err) {
    logger.error('injectPageFonts failed', {
      page: pageIndex + 1,
      error: formatError(err),
    });
  }

  const [paths, images, text, annotations] = await Promise.all([
    runLayer('paths', pageIndex, () => renderPathLayer(ctx)),
    runLayer('images', pageIndex, () => renderImageLayer(ctx)),
    runLayer('text', pageIndex, () => renderTextLayer(ctx)),
    runLayer('annotations', pageIndex, () => renderAnnotationLayer(ctx)),
  ]);

  if (paths) {
    wrapper.appendChild(paths);
  }
  if (images) {
    wrapper.appendChild(images);
  }
  if (text) {
    wrapper.appendChild(text);
  }
  if (annotations) {
    wrapper.appendChild(annotations);
  }
  return wrapper;
}
