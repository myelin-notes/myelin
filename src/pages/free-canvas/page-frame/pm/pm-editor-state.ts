import type { Node as PMNode } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { buildPlugins } from './plugins';
import { schema } from './schema';

/**
 * Manages ProseMirror document state for a single PageFrameElement.
 *
 * The EditorView is created once and kept alive. Editing is toggled
 * via `setEditable()` rather than creating/destroying the view.
 */
export class PageFrameEditorState {
  private _docJSON: Record<string, unknown>;
  private _view: EditorView | null = null;
  private _editable = false;

  constructor(docJSON?: Record<string, unknown>) {
    this._docJSON =
      docJSON ?? (createDefaultDoc().toJSON() as Record<string, unknown>);
  }

  // ── Accessors ──────────────────────────────────────────

  get doc(): PMNode {
    if (this._view) {
      return this._view.state.doc;
    }
    return schema.nodeFromJSON(this._docJSON);
  }

  get docJSON(): Record<string, unknown> {
    if (this._view) {
      return this._view.state.doc.toJSON() as Record<string, unknown>;
    }
    return this._docJSON;
  }

  get view(): EditorView | null {
    return this._view;
  }

  get hasView(): boolean {
    return this._view !== null;
  }

  get editable(): boolean {
    return this._editable;
  }

  // ── Serialization ──────────────────────────────────────

  toJSON(): Record<string, unknown> {
    return this.docJSON;
  }

  static fromJSON(json: Record<string, unknown>): PageFrameEditorState {
    return new PageFrameEditorState(json);
  }

  // ── View lifecycle ─────────────────────────────────────

  /**
   * Create a persistent EditorView mounted into the given container.
   * Starts non-editable. Call `setEditable(true)` to enable editing.
   */
  createView(container: HTMLElement): EditorView {
    if (this._view) {
      this.destroyView();
    }

    const doc = schema.nodeFromJSON(this._docJSON);
    const state = EditorState.create({
      doc,
      plugins: buildPlugins(),
    });

    this._editable = false;
    this._view = new EditorView(container, {
      state,
      editable: () => this._editable,
      dispatchTransaction: (tr) => {
        if (!this._view) {
          return;
        }
        const newState = this._view.state.apply(tr);
        this._view.updateState(newState);
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
    this._view?.setProps({ editable: () => this._editable });
  }

  /**
   * Tear down the view entirely (only needed when the frame is removed).
   */
  destroyView(): void {
    if (this._view) {
      this._docJSON = this._view.state.doc.toJSON() as Record<string, unknown>;
      this._view.destroy();
      this._view = null;
      this._editable = false;
    }
  }

  /**
   * Replace the stored doc (e.g., from undo/redo at the canvas level).
   */
  setDocJSON(json: Record<string, unknown>): void {
    this._docJSON = json;
    if (this._view) {
      const doc = schema.nodeFromJSON(json);
      const state = EditorState.create({
        doc,
        plugins: buildPlugins(),
      });
      this._view.updateState(state);
    }
  }
}

// ── Helpers ──────────────────────────────────────────────

function createDefaultDoc(): PMNode {
  return schema.node('doc', null, [schema.node('paragraph', null)]);
}
