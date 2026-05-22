import { Plugin, TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

const WORD_CHAR = /[\p{L}\p{N}_]/u;
const LEAF_PLACEHOLDER = '￼';

interface Range {
  from: number;
  to: number;
}

/**
 * Resolves a viewport coordinate to a doc position by bypassing
 * `view.posAtCoords`. The page-frame applies `style.zoom = devicePixelRatio`
 * to an ancestor; WebKit's `getBoundingClientRect` doesn't include zoom while
 * `caretRangeFromPoint` does, so PM's coord resolution snaps every click to
 * the nearest block edge. Going through the DOM caret instead gives us an
 * offset that matches what the user actually sees.
 */
function posFromClientCoords(
  view: EditorView,
  clientX: number,
  clientY: number,
): number | null {
  const doc = view.dom.ownerDocument;
  const caret = doc.caretRangeFromPoint?.(clientX, clientY);
  if (!caret) {
    return null;
  }
  const { startContainer, startOffset } = caret;
  if (!view.dom.contains(startContainer)) {
    return null;
  }
  try {
    return view.posAtDOM(startContainer, startOffset, -1);
  } catch {
    return null;
  }
}

function findWordRangeAtPos(view: EditorView, pos: number): Range | null {
  const doc = view.state.doc;
  let $pos = doc.resolve(pos);
  let effectivePos = pos;
  if (!$pos.parent.inlineContent && effectivePos > 0) {
    effectivePos -= 1;
    $pos = doc.resolve(effectivePos);
  }
  if (!$pos.parent.inlineContent) {
    return null;
  }
  const parentStart = $pos.start();
  const text = $pos.parent.textBetween(
    0,
    $pos.parent.content.size,
    LEAF_PLACEHOLDER,
    LEAF_PLACEHOLDER,
  );
  const rel = effectivePos - parentStart;
  if (rel < 0 || rel > text.length) {
    return null;
  }

  let left = rel;
  while (left > 0 && WORD_CHAR.test(text[left - 1])) {
    left--;
  }
  let right = rel;
  while (right < text.length && WORD_CHAR.test(text[right])) {
    right++;
  }

  if (left === right) {
    return null;
  }
  return { from: parentStart + left, to: parentStart + right };
}

export function wordSelectionDragPlugin(): Plugin {
  return new Plugin({
    props: {
      handleDoubleClick(view, _pos, event) {
        if (event.button !== 0 || event.shiftKey) {
          return false;
        }
        const clickPos = posFromClientCoords(
          view,
          event.clientX,
          event.clientY,
        );
        if (clickPos == null) {
          return false;
        }
        const anchorWord = findWordRangeAtPos(view, clickPos);
        if (!anchorWord) {
          return false;
        }

        view.dispatch(
          view.state.tr.setSelection(
            TextSelection.create(
              view.state.doc,
              anchorWord.from,
              anchorWord.to,
            ),
          ),
        );

        const onMouseMove = (e: MouseEvent) => {
          const hoverPos = posFromClientCoords(view, e.clientX, e.clientY);
          if (hoverPos == null) {
            return;
          }
          const hoverWord = findWordRangeAtPos(view, hoverPos);
          const lo = Math.min(
            anchorWord.from,
            hoverWord ? hoverWord.from : hoverPos,
          );
          const hi = Math.max(
            anchorWord.to,
            hoverWord ? hoverWord.to : hoverPos,
          );
          const movingForward = hoverPos >= anchorWord.to;
          const nextSelection = movingForward
            ? TextSelection.create(view.state.doc, lo, hi)
            : TextSelection.create(view.state.doc, hi, lo);
          if (!nextSelection.eq(view.state.selection)) {
            view.dispatch(view.state.tr.setSelection(nextSelection));
          }
        };

        const cleanup = () => {
          document.removeEventListener('mousemove', onMouseMove);
          document.removeEventListener('mouseup', cleanup);
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', cleanup);

        return true;
      },
    },
  });
}
