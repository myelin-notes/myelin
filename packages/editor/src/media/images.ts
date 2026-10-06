import type { DrawableCanvas } from '../drawable-canvas';
import { ImageElement } from '../elements/image-element';
import { PAGE_PADDING, PageFrameElement } from '../elements/page-frame-element';
import { resolveAnchorPosition } from '../page-frame/pm/anchoring';
import { getDevicePixelRatio } from '../utils';
import type { MediaImportOptions } from './index';

export async function imageImportHandler(
  blob: Blob,
  canvas: DrawableCanvas,
  options: MediaImportOptions = {},
) {
  const data = await blob.arrayBuffer();
  const img = canvas.addElement((uuid) => new ImageElement(uuid));
  await img.setImageData(data);

  if (options.pageFramePaste) {
    const target = options.pageFramePaste;
    const frame = canvas.elements.find(
      (element) => element.uuid === target.frameId,
    );
    if (!(frame instanceof PageFrameElement) || !frame.pmEditor?.view) {
      canvas.removeElement(img);
      return;
    }
    const pos = resolveAnchorPosition(
      frame.pmEditor.view.state,
      target.position,
      target.blockPosition,
    );
    canvas.transact(() => {
      const scale = Math.min(
        1,
        ((frame.pageWidth - PAGE_PADDING * 2) * Math.abs(frame.scale.x)) /
          img.naturalWidth,
        ((frame.pageHeight - PAGE_PADDING * 2) * Math.abs(frame.scale.y)) /
          img.naturalHeight,
      );
      img.setScale(scale, scale);
      if (!canvas.anchoring.attachAtPosition(img, frame, pos, true)) {
        canvas.removeElement(img);
      }
    });
    return;
  }

  // Place at given screen position (or center of viewport)
  const dpr = getDevicePixelRatio();
  const cx = options.screenX ?? canvas.ctx.canvas.width / dpr / 2;
  const cy = options.screenY ?? canvas.ctx.canvas.height / dpr / 2;
  const world = canvas.viewport.screenToWorld({ x: cx, y: cy });
  img.setOffset(
    world.x - img.naturalWidth / 2,
    world.y - img.naturalHeight / 2,
  );
  img.updateBounds();
}
