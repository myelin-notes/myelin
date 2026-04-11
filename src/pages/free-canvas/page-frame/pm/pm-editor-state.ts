import type { Node as PMNode } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { PM_ADD_TO_HISTORY, PM_UPDATE_EVENT } from './constants';
import { buildPlugins } from './plugins';
import { schema } from './schema';

/**
 * Manages ProseMirror document state for a single PageFrameElement.
 *
 * The EditorView is created once and kept alive. Editing is toggled
 * via `setEditable()` rather than creating/destroying the view.
 */
export class PageFrameEditorState {
  private _offlineDoc: Record<string, unknown>;
  private _view: EditorView | null = null;
  private _editable = false;

  constructor(docJSON?: Record<string, unknown>) {
    this._offlineDoc =
      docJSON ?? (createDefaultDoc().toJSON() as Record<string, unknown>);
  }

  get doc(): PMNode {
    if (this._view) {
      return this._view.state.doc;
    }
    return schema.nodeFromJSON(this._offlineDoc);
  }

  get docJSON(): Record<string, unknown> {
    if (this._view) {
      return this._view.state.doc.toJSON() as Record<string, unknown>;
    }
    return this._offlineDoc;
  }

  get view(): EditorView | null {
    return this._view;
  }

  toJSON(): Record<string, unknown> {
    return this.docJSON;
  }

  /**
   * Create a persistent EditorView mounted into the given container.
   * Starts non-editable. Call `setEditable(true)` to enable editing.
   *
   * `onPageCount`, when provided, is invoked whenever the pagination plugin
   * computes a new page count for the document.
   */
  createView(
    container: HTMLElement,
    onPageCount?: (pageCount: number) => void,
  ): EditorView {
    if (this._view) {
      this.destroyView();
    }

    const doc = schema.nodeFromJSON(this._offlineDoc);
    const state = EditorState.create({
      doc,
      plugins: buildPlugins(onPageCount),
    });

    this._editable = false;
    this._view = new EditorView(container, {
      state,
      editable: (_state) => this._editable,
      dispatchTransaction: (tr) => {
        if (!this._view) {
          return;
        }
        const newState = this._view.state.apply(tr);
        this._view.updateState(newState);
        this._view.dom.dispatchEvent(new Event(PM_UPDATE_EVENT));
      },
    });

    return this._view;
  }

  /**
   * Toggle whether the editor accepts input.
   */
  setEditable(editable: boolean): void {
    this._editable = editable;
    // Force PM to re-evaluate the editable prop
    this._view?.setProps({ editable: (_state) => this._editable });
  }

  /**
   * Tear down the view entirely (only needed when the frame is removed).
   */
  destroyView(): void {
    if (this._view) {
      this._offlineDoc = this._view.state.doc.toJSON() as Record<
        string,
        unknown
      >;
      this._view.destroy();
      this._view = null;
      this._editable = false;
    }
  }

  /**
   * Replace the stored doc (e.g., from undo/redo at the canvas level).
   */
  setDocJSON(json: Record<string, unknown>): void {
    this._offlineDoc = json;
    if (this._view) {
      const doc = schema.nodeFromJSON(json);
      const tr = this._view.state.tr.replaceWith(
        0,
        this._view.state.doc.content.size,
        doc.content,
      );
      tr.setMeta(PM_ADD_TO_HISTORY, false);
      this._view.dispatch(tr);
    }
  }
}

function createDefaultDoc(): PMNode {
  return schema.node('doc', null, [schema.node('paragraph', null)]);
}
