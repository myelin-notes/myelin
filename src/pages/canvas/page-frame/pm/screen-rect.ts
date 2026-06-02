import type { EditorView } from 'prosemirror-view';
import { PM_EDITOR_CLASS } from './constants';

export interface PageFramePmScreenRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Map a rect from PM/contenteditable space (as returned by
 * `view.coordsAtPos` or `getClientRects`) into viewport screen pixels.
 *
 * The page-frame viewport applies `zoom: devicePixelRatio` (NOT reflected in
 * getBoundingClientRect) plus `transform: scale(canvasZoom / dpr)` (IS
 * reflected). We anchor on the frame's real on-screen rect rather than
 * assuming the editor origin sits at viewport (0,0) — the latter only held
 * while a fixed-width sidebar pinned the canvas, and broke once it was
 * removed. This mirrors `getVisualRectForContentRect` in the dom-layer, which
 * the note-link previews rely on.
 */
export function mapPmRectToScreen(
  frameRect: RectLike,
  contentRect: RectLike,
  rect: { left: number; top: number; right: number; bottom: number },
): PageFramePmScreenRect {
  const scaleX =
    contentRect.width > 0 ? frameRect.width / contentRect.width : 1;
  const scaleY =
    contentRect.height > 0 ? frameRect.height / contentRect.height : 1;

  const left = frameRect.left + (rect.left - contentRect.left) * scaleX;
  const right = frameRect.left + (rect.right - contentRect.left) * scaleX;
  const top = frameRect.top + (rect.top - contentRect.top) * scaleY;
  const bottom = frameRect.top + (rect.bottom - contentRect.top) * scaleY;

  return {
    left,
    right,
    top,
    bottom,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
}

/**
 * Screen-pixel rect for a single PM document position, resolved against the
 * editor's own frame/content DOM so it stays correct wherever the canvas sits
 * in the window. Returns `null` if the DOM isn't mounted or the position is
 * stale.
 */
export function getPageFramePmScreenRectForPos(
  view: EditorView,
  position: number,
): PageFramePmScreenRect | null {
  const contentDiv = view.dom.closest<HTMLElement>(`.${PM_EDITOR_CLASS}`);
  // frame > viewport (zoom + scale) > content > view.dom
  const frameDiv = contentDiv?.parentElement?.parentElement ?? null;
  if (!(contentDiv && frameDiv)) {
    return null;
  }
  try {
    return mapPmRectToScreen(
      frameDiv.getBoundingClientRect(),
      contentDiv.getBoundingClientRect(),
      view.coordsAtPos(position),
    );
  } catch {
    return null;
  }
}
