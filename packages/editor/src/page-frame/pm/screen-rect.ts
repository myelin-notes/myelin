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
 * Map a rect from PM/contenteditable space into viewport screen pixels.
 *
 * The page-frame viewport applies `zoom: devicePixelRatio` (NOT reflected in getBoundingClientRect)
 * plus `transform: scale(canvasZoom / dpr)` (IS reflected), and anchors on the frame's real
 * on-screen rect rather than assuming the editor origin sits at viewport (0,0).
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

function mapViewRectToScreen(
  view: EditorView,
  rect: { left: number; top: number; right: number; bottom: number },
): PageFramePmScreenRect | null {
  const contentDiv = view.dom.closest<HTMLElement>(`.${PM_EDITOR_CLASS}`);
  // frame > viewport (zoom + scale) > content > view.dom
  const frameDiv = contentDiv?.parentElement?.parentElement ?? null;
  if (!(contentDiv && frameDiv)) {
    return null;
  }
  return mapPmRectToScreen(
    frameDiv.getBoundingClientRect(),
    contentDiv.getBoundingClientRect(),
    rect,
  );
}

// Returns `null` if the DOM isn't mounted or the position is stale.
export function getPageFramePmScreenRectForPos(
  view: EditorView,
  position: number,
): PageFramePmScreenRect | null {
  try {
    return mapViewRectToScreen(view, view.coordsAtPos(position));
  } catch {
    return null;
  }
}

export function getPageFramePmScreenRectForElement(
  view: EditorView,
  element: HTMLElement,
): PageFramePmScreenRect | null {
  return mapViewRectToScreen(view, element.getBoundingClientRect());
}

/**
 * Screen rect for the caret inside a nested CodeMirror editor (code block, math source). Those node
 * views have no contentDOM, so `coordsAtPos` degrades to the block boundary — following that would
 * pan the canvas to the block. Measures the native DOM selection instead; `null` when the selection
 * isn't in a nested editor of this view (callers fall back to `getPageFramePmScreenRectForPos`).
 */
export function getPageFramePmScreenRectForNestedCaret(
  view: EditorView,
): PageFramePmScreenRect | null {
  const selection = view.dom.ownerDocument.getSelection();
  if (!selection?.focusNode || selection.rangeCount === 0) {
    return null;
  }
  const focusEl =
    selection.focusNode instanceof Element
      ? selection.focusNode
      : selection.focusNode.parentElement;
  const editorEl = focusEl?.closest('.cm-editor');
  if (!editorEl || !view.dom.contains(editorEl)) {
    return null;
  }

  // A collapsed caret usually exposes a rect via getClientRects; an empty
  // line can yield none — fall back to the block-boundary measure then.
  const rect = selection.getRangeAt(0).getClientRects()[0];
  if (!rect || (rect.width === 0 && rect.height === 0)) {
    return null;
  }
  return mapViewRectToScreen(view, rect);
}
