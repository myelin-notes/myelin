import { loadDocument } from '@/lib/pdf-renderer';
import type { DrawableCanvas } from '../drawable-canvas';
import { PdfElement } from '../elements/pdf-element';

export async function pdfImportHandler(
  blob: Blob,
  canvas: DrawableCanvas,
  screenX?: number,
  screenY?: number,
) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const doc = await loadDocument(bytes);
  const pageSizes: { w: number; h: number }[] = [];
  for (let i = 0; i < doc.numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 1 });
    pageSizes.push({ w: viewport.width, h: viewport.height });
  }

  const pdf = canvas.addElement((i) => new PdfElement(i));
  const fileName = blob instanceof File ? blob.name : '';
  pdf.setInitialPdfData(bytes, pageSizes, fileName, doc);

  const dpr = window.devicePixelRatio || 1;
  const cx = screenX ?? canvas.ctx.canvas.width / dpr / 2;
  const cy = screenY ?? canvas.ctx.canvas.height / dpr / 2;
  const world = canvas.viewport.screenToWorld({ x: cx, y: cy });
  pdf.setOffset(world.x - pdf.totalWidth / 2, world.y - pdf.totalHeight / 2);
  pdf.updateBounds();
  canvas.updateBounding();
}
