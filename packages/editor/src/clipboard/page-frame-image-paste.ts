import type { DrawableCanvas } from '../drawable-canvas';
import { PageFrameElement } from '../elements/page-frame-element';
import type { PageFramePasteTarget } from '../page-frame/anchoring';
import { encodeAnchorPosition } from '../page-frame/pm/anchoring';

export function handlePageFrameImagePaste(
  event: ClipboardEvent,
  canvas: DrawableCanvas,
  paste: (files: File[], target: PageFramePasteTarget) => void,
): boolean {
  const frame = canvas.editingElement;
  if (!(frame instanceof PageFrameElement)) {
    return false;
  }
  const view = frame.pmEditor?.view;
  if (!view || (event.target && !view.dom.contains(event.target as Node))) {
    return false;
  }
  const files = Array.from(event.clipboardData?.items ?? [])
    .filter((item) => item.type.startsWith('image/'))
    .flatMap((item) => {
      const file = item.getAsFile();
      return file ? [file] : [];
    });
  if (!files.length) {
    return false;
  }
  const { state } = view;
  const pos = state.selection.from;
  const resolved = state.doc.resolve(pos);
  const target: PageFramePasteTarget = {
    frameId: frame.uuid,
    position: encodeAnchorPosition(state, pos),
    blockPosition: encodeAnchorPosition(
      state,
      resolved.depth > 0 ? resolved.before(1) : pos,
    ),
  };
  event.preventDefault();
  event.stopPropagation();
  paste(files, target);
  return true;
}
