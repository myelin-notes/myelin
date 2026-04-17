import type { PdfDocument } from './document';
import { injectPageFonts } from './fonts';
import { renderAnnotationLayer } from './layers/annotation-layer';
import { renderImageLayer } from './layers/image-layer';
import { renderPathLayer } from './layers/path-layer';
import { renderTextLayer } from './layers/text-layer';
import type { RenderContext } from './types';

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
    console.error(
      `[pdf-renderer] layer '${name}' on page ${pageIndex + 1} failed: ${formatError(err)}`,
    );
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
    console.error(
      `[pdf-renderer] getOperatorList page ${pageIndex + 1} failed: ${formatError(err)}`,
    );
    throw err;
  }
  try {
    await injectPageFonts(doc, page);
  } catch (err) {
    console.error(
      `[pdf-renderer] injectPageFonts page ${pageIndex + 1} failed: ${formatError(err)}`,
    );
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
