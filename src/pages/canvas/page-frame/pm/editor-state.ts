import { EditorState, Selection, type Transaction } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import type * as Y from 'yjs';
import {
  CODE_BLOCK_CLEAR_SELECTION_EVENT,
  PM_UPDATE_EVENT,
} from '@/lib/events';
import type { ResolveNoteLink } from './markdown/note-links';
import { buildNodeViews } from './node-views';
import { buildPlugins } from './plugins';
import { schema } from './schema';

const CODE_BLOCK_NODE_VIEW_SELECTOR = '.pm-monaco-code-block';

/**
 * Manages ProseMirror document state for a single PageFrameElement.
 *
 * The Y.XmlFragment is the source of truth for document content.
 * The EditorView is created once and kept alive. Editing is toggled
 * via `setEditable()` rather than creating/destroying the view.
 */
export class PageFrameEditorState {
  private _view: EditorView | null = null;
  private _editable = false;

  constructor(
    private readonly _yXmlFragment: Y.XmlFragment,
    private readonly _resolveNoteLink?: ResolveNoteLink,
  ) {}

  get view(): EditorView | null {
    return this._view;
  }

  get editable(): boolean {
    return this._editable;
  }

  hasFocus(): boolean {
    const activeElement = document.activeElement;
    return (
      activeElement instanceof HTMLElement &&
      this._view?.dom.contains(activeElement) === true
    );
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

    const state = EditorState.create({
      schema,
      plugins: buildPlugins(
        this._yXmlFragment,
        onPageCount,
        this._resolveNoteLink,
      ),
    });

    this._editable = false;

    // Use a regular function for dispatchTransaction so ProseMirror binds
    // the EditorView as `this`. This is critical because ySyncPlugin
    // dispatches a transaction during the EditorView constructor (to load
    // XmlFragment content), before `this._view` is assigned.
    const editable = () => this._editable;

    this._view = new EditorView(container, {
      state,
      editable: (_state) => editable(),
      nodeViews: buildNodeViews(),
      dispatchTransaction(this: EditorView, tr: Transaction) {
        // `this` is the EditorView (bound by ProseMirror via .call())
        const hadNestedFocus =
          document.activeElement instanceof HTMLElement &&
          this.dom.contains(document.activeElement);
        const wasInCodeBlock =
          this.state.selection.$from.parent.type === schema.nodes.codeBlock;
        const newState = this.state.apply(tr);
        this.updateState(newState);
        const isInCodeBlock =
          newState.selection.$from.parent.type === schema.nodes.codeBlock;
        if (hadNestedFocus && wasInCodeBlock && !isInCodeBlock) {
          this.focus();
        }
        this.dom.dispatchEvent(new Event(PM_UPDATE_EVENT));
      },
    });

    // ySyncPlugin may focus the view during init — blur immediately
    // since the editor starts non-editable.
    if (
      document.activeElement instanceof HTMLElement &&
      this._view.dom.contains(document.activeElement)
    ) {
      (document.activeElement as HTMLElement).blur();
    }

    return this._view;
  }

  /**
   * Toggle whether the editor accepts input.
   */
  setEditable(editable: boolean): void {
    this._editable = editable;
    this._view?.setProps({ editable: (_state) => this._editable });
  }

  focus(): void {
    this._view?.focus();
  }

  ensureFocused(): void {
    if (this._editable && !this.hasFocus()) {
      this.focus();
    }
  }

  blur(): void {
    const activeElement = document.activeElement;
    if (
      activeElement instanceof HTMLElement &&
      this._view?.dom.contains(activeElement)
    ) {
      activeElement.blur();
    }
  }

  clearSelection(): void {
    const view = this._view;
    if (!view) {
      return;
    }

    const { state } = view;
    if (!state.selection.empty) {
      view.dispatch(
        state.tr.setSelection(
          Selection.near(state.doc.resolve(state.selection.head)),
        ),
      );
    }

    view.dom
      .querySelectorAll<HTMLElement>(CODE_BLOCK_NODE_VIEW_SELECTOR)
      .forEach((dom) => {
        dom.dispatchEvent(new CustomEvent(CODE_BLOCK_CLEAR_SELECTION_EVENT));
      });

    const nativeSelection = view.dom.ownerDocument.getSelection();
    const anchorNode = nativeSelection?.anchorNode;
    if (anchorNode && view.dom.contains(anchorNode)) {
      nativeSelection?.removeAllRanges();
    }
  }

  /**
   * Tear down the view entirely (only needed when the frame is removed).
   */
  destroyView(): void {
    if (this._view) {
      this._view.destroy();
      this._view = null;
      this._editable = false;
    }
  }
}
