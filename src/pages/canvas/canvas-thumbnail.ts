import { getScratchCanvasContext } from '@/lib/scratch-canvas';
import type { DrawableElement } from './elements/drawable-element';

/**
 * Render a document thumbnail by replaying each element's draw pass into an
 * off-screen canvas, mirroring the live 2D render. Returns `null` when there's
 * nothing to draw.
 */
export async function renderCanvasThumbnail(
  elements: readonly DrawableElement[],
  contentBounds: DOMRect,
  maxSize: number,
): Promise<Blob | null> {
  if (
    elements.length === 0 ||
    contentBounds.width <= 0 ||
    contentBounds.height <= 0
  ) {
    return null;
  }

  const scale = Math.min(
    1,
    maxSize / Math.max(contentBounds.width, contentBounds.height),
  );
  const width = Math.max(1, Math.round(contentBounds.width * scale));
  const height = Math.max(1, Math.round(contentBounds.height * scale));

  const visible = elements.filter((el) => !el.hidden);
  for (const el of visible) {
    await el.prepareThumbnail(scale);
  }

  const scratch = getScratchCanvasContext(width, height);
  try {
    const ctx = scratch.context;
    ctx.imageSmoothingQuality = 'high';
    ctx.scale(scale, scale);
    ctx.translate(-contentBounds.x, -contentBounds.y);

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
