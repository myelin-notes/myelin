import type { Node as PMNode } from 'prosemirror-model';
import { TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { NestedEditorSelection } from './editor';

interface BoundaryEditor {
  getSelection: () => NestedEditorSelection;
  getCursorPosition: () => { column: number; lineNumber: number };
  getLineMaxColumn: (lineNumber: number) => number | null;
}

interface BoundaryInputEvent {
  altKey: boolean;
  ctrlKey: boolean;
  isComposing: boolean;
  key: string;
  metaKey: boolean;
}

// True when the selection is empty, the cursor sits at the end of `closingFenceLine`, no
// modifiers/composition are active, and the key is Enter or a single printable character.
export function shouldMoveInputOutsideBlock(
  editor: BoundaryEditor,
  closingFenceLine: number | null,
  event: BoundaryInputEvent,
): boolean {
  if (!editor.getSelection().empty) {
    return false;
  }

  if (closingFenceLine == null) {
    return false;
  }

  const position = editor.getCursorPosition();
  const lineMaxColumn = editor.getLineMaxColumn(closingFenceLine);
  if (lineMaxColumn == null) {
    return false;
  }
  if (
    position.lineNumber !== closingFenceLine ||
    position.column !== lineMaxColumn
  ) {
    return false;
  }

  if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) {
    return false;
  }

  if (event.key === 'Enter') {
    return true;
  }

  return event.key.length === 1;
}

// Reuses the following paragraph when there is one, otherwise creates it, then hands focus back
// to the ProseMirror view.
export function insertTextAfterBlock(
  view: EditorView,
  getPos: () => number,
  node: PMNode,
  text: string,
): void {
  const insertPos = getPos() + node.nodeSize;
  const paragraphType = view.state.schema.nodes.paragraph;
  let tr = view.state.tr;
  const nextNode = tr.doc.resolve(insertPos).nodeAfter;

  if (nextNode?.type !== paragraphType) {
    const paragraph = paragraphType.createAndFill();
    if (!paragraph) {
      return;
    }
    tr = tr.insert(insertPos, paragraph);
  }

  let selectionPos = insertPos + 1;
  if (text.length > 0) {
    tr = tr.insertText(text, selectionPos, selectionPos);
    selectionPos += text.length;
  }

  tr = tr.setSelection(TextSelection.create(tr.doc, selectionPos));
  view.dispatch(tr.scrollIntoView());
  view.focus();
}
