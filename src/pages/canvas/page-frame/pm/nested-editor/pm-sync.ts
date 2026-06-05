import { Selection, TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { NestedEditorDirection, NestedEditorSelection } from './editor';

/**
 * The slice of a nested editor the ProseMirror forwarding helpers read.
 * Kept structural (instead of importing the editor classes) so this module
 * never drags the CodeMirror runtime into the main chunk.
 */
interface NestedEditorContent {
  getValue: () => string;
  getSelection: () => NestedEditorSelection;
}

function findTextDiff(current: string, next: string) {
  if (current === next) {
    return null;
  }

  let start = 0;
  let currentEnd = current.length;
  let nextEnd = next.length;

  while (
    start < currentEnd &&
    start < nextEnd &&
    current.charCodeAt(start) === next.charCodeAt(start)
  ) {
    start += 1;
  }

  while (
    currentEnd > start &&
    nextEnd > start &&
    current.charCodeAt(currentEnd - 1) === next.charCodeAt(nextEnd - 1)
  ) {
    currentEnd -= 1;
    nextEnd -= 1;
  }

  return {
    from: start,
    insert: next.slice(start, nextEnd),
    to: currentEnd,
  };
}

/**
 * Apply the nested editor's document and selection to ProseMirror as a
 * minimal replace transaction. `offset` is the PM position of the block's
 * first character (node position + 1); `currentText` is the block node's
 * text the editor was last synced against.
 */
export function forwardNestedContentUpdate(
  view: EditorView,
  offset: number,
  currentText: string,
  editor: NestedEditorContent,
): void {
  const nextText = editor.getValue();
  const selection = editor.getSelection();
  const selFrom = offset + selection.from;
  const selTo = offset + selection.to;
  const pmSelection = view.state.selection;
  const diff = findTextDiff(currentText, nextText);

  if (!diff && pmSelection.from === selFrom && pmSelection.to === selTo) {
    return;
  }

  const tr = view.state.tr;
  if (diff) {
    if (diff.insert.length > 0) {
      tr.replaceWith(
        offset + diff.from,
        offset + diff.to,
        view.state.schema.text(diff.insert),
      );
    } else {
      tr.delete(offset + diff.from, offset + diff.to);
    }
  }
  tr.setSelection(TextSelection.create(tr.doc, selFrom, selTo));
  view.dispatch(tr);
}

/** Mirror the nested editor's cursor/selection into ProseMirror. */
export function forwardNestedSelectionUpdate(
  view: EditorView,
  offset: number,
  editor: NestedEditorContent,
): void {
  const selection = editor.getSelection();
  const selFrom = offset + selection.from;
  const selTo = offset + selection.to;
  const pmSelection = view.state.selection;
  if (pmSelection.from === selFrom && pmSelection.to === selTo) {
    return;
  }

  view.dispatch(
    view.state.tr.setSelection(
      TextSelection.create(view.state.doc, selFrom, selTo),
    ),
  );
}

/**
 * Move the ProseMirror selection just outside the block (arrow pressed at a
 * boundary inside the nested editor) and return focus to the PM view.
 */
export function escapeNestedEditor(
  view: EditorView,
  nodePos: number,
  nodeSize: number,
  dir: NestedEditorDirection,
): void {
  const targetPos = nodePos + (dir < 0 ? 0 : nodeSize);
  const nextSelection = Selection.near(view.state.doc.resolve(targetPos), dir);
  const tr = view.state.tr.setSelection(nextSelection).scrollIntoView();
  view.dispatch(tr);
  view.focus();
}
