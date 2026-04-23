import type { DrawableCanvas } from '../drawable-canvas';
import { PageFrameElement } from '../elements/page-frame-element';
import { writeMarkdownToPageFrameFragment } from '../page-frame/markdown-import';

export async function markdownImportHandler(
  blob: Blob,
  canvas: DrawableCanvas,
  screenX?: number,
  screenY?: number,
) {
  const text = await blob.text();
  const pf = canvas.addElement((i) => new PageFrameElement(i));
  const frag = pf.yXmlFragment;
  if (frag) {
    canvas.ydoc.transact(() => {
      writeMarkdownToPageFrameFragment(text, frag);
    });
  }

  const dpr = window.devicePixelRatio || 1;
  const cx = screenX ?? canvas.ctx.canvas.width / dpr / 2;
  const cy = screenY ?? canvas.ctx.canvas.height / dpr / 2;
  const world = canvas.viewport.screenToWorld({ x: cx, y: cy });
  pf.setOffset(world.x - pf.pageWidth / 2, world.y - pf.pageHeight / 2);
  pf.updateBounds();
  canvas.updateBounding();
}
