import { getScratchCanvasContext } from '@/lib/scratch-canvas';
import type { DrawableElement } from './elements/drawable-element';

/**
 * Render a document thumbnail by replaying each element's draw pass into an
 * off-screen canvas, mirroring the live 2D render. `region` is the world-space
 * rect to capture (the viewport's visible area), so the thumbnail is a snapshot
 * of what the user currently sees. Elements outside the region are culled.
 * Returns `null` when there's nothing to draw.
 */
export async function renderCanvasThumbnail(
  elements: readonly DrawableElement[],
  region: DOMRect,
  maxSize: number,
): Promise<Blob | null> {
  if (elements.length === 0 || region.width <= 0 || region.height <= 0) {
    return null;
  }

  const visible = elements.filter(
    (el) => !el.hidden && intersects(el.boundingBox, region),
  );
  if (visible.length === 0) {
    return null;
  }

  const scale = Math.min(1, maxSize / Math.max(region.width, region.height));
  const width = Math.max(1, Math.round(region.width * scale));
  const height = Math.max(1, Math.round(region.height * scale));

  for (const el of visible) {
    await el.prepareThumbnail(scale);
  }

  const scratch = getScratchCanvasContext(width, height);
  try {
    const ctx = scratch.context;
    ctx.imageSmoothingQuality = 'high';
    ctx.scale(scale, scale);
    ctx.translate(-region.x, -region.y);

    for (const el of visible) {
      ctx.save();
      ctx.translate(el.offset.x, el.offset.y);
      ctx.scale(el.scale.x, el.scale.y);
      el.drawThumbnail(ctx, 0);
      ctx.restore();
    }

    return await scratch.toBlob({ type: 'image/png' });
  } finally {
    scratch.release();
  }
}

/** True when two world-space rects overlap (touching edges don't count). */
function intersects(a: DOMRect, b: DOMRect): boolean {
  return (
    a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
  );
}
