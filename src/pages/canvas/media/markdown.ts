import { UserPrefs } from '@/lib/user-prefs';
import type { DrawableCanvas } from '../drawable-canvas';
import { PageFrameElement } from '../elements/page-frame-element';
import { writeMarkdownToPageFrameFragment } from '../page-frame/markdown/import';
import type { MediaImportOptions } from './index';

export async function markdownImportHandler(
  blob: Blob,
  canvas: DrawableCanvas,
  options: MediaImportOptions = {},
) {
  const text = await blob.text();
  const pf = canvas.addElement(
    (uuid) =>
      new PageFrameElement(uuid, undefined, UserPrefs.get('defaultPageLayout')),
  );
  const frag = pf.yXmlFragment;
  if (frag) {
    await writeMarkdownToPageFrameFragment(text, frag, {
      repository: options.repository,
    });
  }

  const dpr = window.devicePixelRatio || 1;
  const cx = options.screenX ?? canvas.ctx.canvas.width / dpr / 2;
  const cy = options.screenY ?? canvas.ctx.canvas.height / dpr / 2;
  const world = canvas.viewport.screenToWorld({ x: cx, y: cy });
  pf.setOffset(world.x - pf.pageWidth / 2, world.y - pf.pageHeight / 2);
  pf.updateBounds();
}
