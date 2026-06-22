import { UserPrefs } from '@/lib/user-prefs';
import { getDevicePixelRatio } from '@/lib/utils';
import type { DrawableCanvas } from '../drawable-canvas';
import { PdfElement } from '../elements/pdf-element';
import { getPdfPageSizes } from '../pdf-renderer';
import type { MediaImportOptions } from './index';

export async function pdfImportHandler(
  blob: Blob,
  canvas: DrawableCanvas,
  options: MediaImportOptions = {},
) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const pageSizes = await getPdfPageSizes(bytes);
  const pdf = canvas.addElement(
    (uuid) => new PdfElement(uuid, UserPrefs.get('defaultPageLayout')),
  );
  const fileName = blob instanceof File ? blob.name : '';
  pdf.setInitialPdfData(bytes, fileName, pageSizes);

  const dpr = getDevicePixelRatio();
  const cx = options.screenX ?? canvas.ctx.canvas.width / dpr / 2;
  const cy = options.screenY ?? canvas.ctx.canvas.height / dpr / 2;
  const world = canvas.viewport.screenToWorld({ x: cx, y: cy });
  pdf.setOffset(world.x - pdf.totalWidth / 2, world.y - pdf.totalHeight / 2);
  pdf.updateBounds();
}
