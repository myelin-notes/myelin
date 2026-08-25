import type { Node as PMNode } from 'prosemirror-model';
import { TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

/**
 * Without this the canvas pan handler swallows wheel events and a page-capped preview can never
 * scroll. Only consumed while the block is being edited (its `editingClass` is on `dom`), and never
 * for ctrl-wheel (pinch zoom).
 */
export function makePreviewWheelHandler(
  dom: HTMLElement,
  preview: HTMLElement,
  editingClass: string,
): (event: WheelEvent) => void {
  return (event) => {
    if (event.ctrlKey || !dom.classList.contains(editingClass)) {
      return;
    }
    const overflowing =
      preview.scrollHeight > preview.clientHeight + 1 ||
      preview.scrollWidth > preview.clientWidth + 1;
    if (overflowing) {
      event.stopPropagation();
    }
  };
}

/**
 * Clicking the rendered preview opens the source editor with the cursor at the end of the source.
 * ProseMirror may skip NodeView.setSelection while the view itself isn't focused, so the editor is
 * opened directly as well. `getNode` is read per click because the node view reassigns its node in
 * update().
 */
export function makePreviewMouseDownHandler(
  view: EditorView,
  getPos: () => number,
  getNode: () => PMNode,
  openEditor: () => void,
): (event: MouseEvent) => void {
  return (event) => {
    if (event.button !== 0 || !view.editable) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const end = getPos() + getNode().nodeSize - 1;
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, end)),
    );
    openEditor();
  };
}
