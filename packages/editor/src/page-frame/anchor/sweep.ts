import type { DrawableCanvas } from '../../drawable-canvas';
import { ElementType } from '../../elements/element-type';
import type { PageFrameElement } from '../../elements/page-frame-element';
import { listBandIds, removeBands } from './band';

const pending = new Set<DrawableCanvas>();
let scheduled = 0;

/**
 * Drops bands nothing is anchored to any more, closing the space they held. Band edits are kept
 * out of the editor's undo stack, so this — not undo — is what reverses a band when its ink is
 * erased, undone, or dragged away. Coalesced to one pass per animation frame: an eraser sweep
 * deletes many strokes in a row.
 */
export function scheduleBandSweep(canvas: DrawableCanvas): void {
  pending.add(canvas);
  if (scheduled !== 0) {
    return;
  }
  scheduled = requestAnimationFrame(() => {
    scheduled = 0;
    const targets = Array.from(pending);
    pending.clear();
    for (const target of targets) {
      sweepOrphanBands(target);
    }
  });
}

export function sweepOrphanBands(canvas: DrawableCanvas): void {
  const live = new Set<string>();
  for (const element of canvas.elements) {
    const bandId = element.anchoredBandId;
    if (bandId !== null) {
      live.add(bandId);
    }
  }

  for (const frame of canvas.getElementsByType(ElementType.PAGE_FRAME)) {
    const view = (frame as PageFrameElement).pmEditor?.view;
    if (!view) {
      continue;
    }
    const orphans = new Set(
      listBandIds(view.state.doc).filter((id) => !live.has(id)),
    );
    if (orphans.size > 0) {
      removeBands(view, orphans);
    }
  }
}
