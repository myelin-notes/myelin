import type { DrawableElement } from './elements/drawable-element';
import { getScratchCanvasContext } from './scratch-canvas';

/**
 * Thumbnails display in fixed-aspect `aspect-[16/10]` object-cover containers
 * (see `src/pages/library/explorer/grid/item-styles.ts`), so the capture
 * region is expanded to this aspect to avoid crop/zoom on display.
 */
const THUMBNAIL_ASPECT = 16 / 10;

/**
 * Render a document thumbnail by replaying each element's draw pass into an
 * off-screen canvas, mirroring the live 2D render. `region` is the world-space
 * rect to capture (the viewport's visible area), so the thumbnail is a snapshot
 * of what the user currently sees. The region is expanded to 16:10 to match
 * the display containers; elements outside the expanded region are culled.
 * When there's nothing to draw, returns a blank image of the capture region.
 */
export async function renderCanvasThumbnail(
  elements: readonly DrawableElement[],
  region: DOMRect,
  maxSize: number,
): Promise<Blob> {
  const capture = snapToThumbnailAspect(region);

  const visible = elements.filter(
    (el) => !el.hidden && intersects(el.boundingBox, capture),
  );

  const scale = Math.min(1, maxSize / Math.max(capture.width, capture.height));
  const width = Math.max(1, Math.round(capture.width * scale));
  const height = Math.max(1, Math.round(capture.height * scale));

  for (const el of visible) {
    await el.prepareThumbnail(scale, capture);
  }

  const scratch = getScratchCanvasContext(width, height);
  try {
    const ctx = scratch.context;
    ctx.imageSmoothingQuality = 'high';
    ctx.scale(scale, scale);
    ctx.translate(-capture.x, -capture.y);

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

/**
 * Expand `region` (centered) to exactly 16:10, growing the short dimension so
 * everything originally in frame stays in frame.
 */
function snapToThumbnailAspect(region: DOMRect): DOMRect {
  if (region.width / region.height < THUMBNAIL_ASPECT) {
    const width = region.height * THUMBNAIL_ASPECT;
    return new DOMRect(
      region.x - (width - region.width) / 2,
      region.y,
      width,
      region.height,
    );
  }
  const height = region.width / THUMBNAIL_ASPECT;
  return new DOMRect(
    region.x,
    region.y - (height - region.height) / 2,
    region.width,
    height,
  );
}

/** True when two world-space rects overlap (touching edges don't count). */
function intersects(a: DOMRect, b: DOMRect): boolean {
  return (
    a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
  );
}
