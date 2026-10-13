import { Selection, TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

interface LineRect {
  top: number;
  bottom: number;
}

function onLine(rect: LineRect, line: LineRect): boolean {
  const mid = (rect.top + rect.bottom) / 2;
  return mid >= line.top && mid <= line.bottom;
}

// These scan for any change of line rather than asking `endOfTextblock`, which only looks for lines
// below the caret: in the horizontal layout a paragraph continues at the top of the next CSS column.

// `null` when `pos` is on its textblock's last visual line.
function nextLineStart(
  view: EditorView,
  pos: number,
  end: number,
): number | null {
  const line = view.coordsAtPos(pos, 1);
  for (let p = pos + 1; p <= end; p++) {
    if (!onLine(view.coordsAtPos(p, 1), line)) {
      return p;
    }
  }
  return null;
}

// `null` when `pos` is on its textblock's first visual line.
function prevLineEnd(
  view: EditorView,
  pos: number,
  start: number,
): number | null {
  const line = view.coordsAtPos(pos, 1);
  for (let p = pos - 1; p >= start; p--) {
    if (!onLine(view.coordsAtPos(p, -1), line)) {
      return p;
    }
  }
  return null;
}

function lineStart(view: EditorView, pos: number, start: number): number {
  const line = view.coordsAtPos(pos, -1);
  let p = pos;
  while (p > start && onLine(view.coordsAtPos(p - 1, 1), line)) {
    p--;
  }
  return p;
}

// For a selection head at the start of a line that opens with a rendered formula. ProseMirror puts
// the DOM caret before the formula's uneditable widget; WebKit's native up/down from there lands just
// after the widget, which maps back to the same doc position, so the caret snaps back and never
// leaves the line. Moves the head to the start of the adjacent visual line instead — where a
// line-start caret would go natively.
export function moveVerticallyFromLeadingMath(
  view: EditorView,
  dir: -1 | 1,
  extend: boolean,
): boolean {
  const { state } = view;
  const { $head, anchor } = state.selection;

  let head =
    dir > 0
      ? nextLineStart(view, $head.pos, $head.end())
      : prevLineEnd(view, $head.pos, $head.start());
  let toLineStart = dir < 0;
  if (head === null) {
    const beyond = Selection.findFrom(
      state.doc.resolve(dir > 0 ? $head.after() : $head.before()),
      dir,
      extend,
    );
    if (!beyond) {
      return false;
    }
    if (!(beyond instanceof TextSelection)) {
      view.dispatch(state.tr.setSelection(beyond));
      return true;
    }
    head = beyond.head;
    // Code and math blocks are entered at their edge, as the keymap's arrow handler does.
    if (beyond.$head.parent.type.spec.code) {
      toLineStart = false;
    }
  }
  if (toLineStart) {
    head = lineStart(view, head, state.doc.resolve(head).start());
  }

  view.dispatch(
    state.tr.setSelection(
      TextSelection.create(state.doc, extend ? anchor : head, head),
    ),
  );
  return true;
}
