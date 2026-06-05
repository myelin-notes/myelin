import { exitCode, joinBackward } from 'prosemirror-commands';
import type { Node as PMNode } from 'prosemirror-model';
import { TextSelection } from 'prosemirror-state';
import type { EditorView, NodeView } from 'prosemirror-view';
import { redo, undo } from 'y-prosemirror';
import { PM_EDITOR_CLASS } from '../constants';
import type {
  NestedEditorDirection,
  NestedEditorEscapeUnit,
} from '../nested-editor/editor';
import {
  escapeNestedEditor,
  forwardNestedContentUpdate,
  forwardNestedSelectionUpdate,
} from '../nested-editor/pm-sync';
import { exitMathBlock } from './block-commands';
import { parseMathMarkdown, stripMathDelimiters } from './parse-math-block';
import { renderKatex } from './render';
import type { MathSourceEditor, MathSourceEditorOwner } from './source-editor';

const SOURCE_GAP = 4;

/**
 * Renders a math block as a KaTeX preview plus a floating raw-source editor.
 * The math preview plugin toggles `pm-math-block--editing` on the wrapper
 * (via a node decoration) while the selection is contained in the block; CSS
 * shows the source panel only then — and only once the shared CodeMirror
 * editor is actually attached to it.
 *
 * The source editor is one shared CodeMirror instance (see ./source-editor)
 * re-parented into the active block's panel rather than constructed per
 * block. The ProseMirror document stays the source of truth: CodeMirror
 * edits and selection moves are forwarded as transactions, mirroring
 * CodeBlockNodeView.
 */
export class MathBlockNodeView implements NodeView {
  dom: HTMLDivElement;
  private preview: HTMLDivElement;
  private source: HTMLDivElement;
  private node: PMNode;
  private editor: MathSourceEditor | null = null;
  private destroyed = false;
  private updating = false;
  private initializing = false;

  private readonly owner: MathSourceEditorOwner = {
    onContentChange: () => this.forwardContentUpdate(),
    onDeleteEmptyBlock: () => this.deleteEmptyBlock(),
    onEnter: () => this.handleEnter(),
    onEscapeRequest: (unit, dir) => this.maybeEscape(unit, dir),
    onExitBlock: () => this.exitBlock(),
    onRedo: () => {
      redo(this.view.state);
    },
    onSelectAll: () => this.selectAllContent(),
    onSelectionChange: () => this.forwardSelectionUpdate(),
    onUndo: () => {
      undo(this.view.state);
    },
  };

  // Without this the canvas pan handler swallows wheel events, so a
  // page-capped preview can never scroll. Mirrors MathSourceEditor's wheel
  // handling: only consume the event while the block is being edited, and
  // never for ctrl-wheel (pinch zoom).
  private readonly handleWheel = (event: WheelEvent): void => {
    if (
      event.ctrlKey ||
      !this.dom.classList.contains('pm-math-block--editing')
    ) {
      return;
    }
    const overflowing =
      this.preview.scrollHeight > this.preview.clientHeight + 1 ||
      this.preview.scrollWidth > this.preview.clientWidth + 1;
    if (overflowing) {
      event.stopPropagation();
    }
  };

  // Clicking the rendered formula opens the source editor with the cursor at
  // the end of the LaTeX. ProseMirror may skip NodeView.setSelection while
  // the view itself isn't focused, so open the editor directly as well.
  private readonly handlePreviewMouseDown = (event: MouseEvent): void => {
    if (event.button !== 0 || !this.view.editable) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const end = this.getPos() + this.node.nodeSize - 1;
    this.view.dispatch(
      this.view.state.tr.setSelection(
        TextSelection.create(this.view.state.doc, end),
      ),
    );
    this.openEditor();
  };

  constructor(
    node: PMNode,
    private readonly view: EditorView,
    private readonly getPos: () => number,
  ) {
    this.node = node;

    this.dom = document.createElement('div');
    this.dom.className = 'pm-math-block';

    this.preview = document.createElement('div');
    this.preview.className = 'pm-math-block-preview pm-page-capped';
    this.preview.contentEditable = 'false';
    this.preview.addEventListener('wheel', this.handleWheel);
    this.preview.addEventListener('mousedown', this.handlePreviewMouseDown);

    this.source = document.createElement('div');
    this.source.className = 'pm-math-block-source';

    this.dom.append(this.preview, this.source);
    this.renderPreview();
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) {
      return false;
    }

    const changed = node.textContent !== this.node.textContent;
    this.node = node;
    if (changed) {
      this.renderPreview();
      if (!this.updating && this.editor?.ownedBy(this.owner)) {
        this.updating = true;
        try {
          this.editor.setValue(node.textContent);
        } finally {
          this.updating = false;
        }
      }
    }
    return true;
  }

  setSelection(anchor: number, head: number): void {
    if (this.editor) {
      this.attachAndSelect(anchor, head);
      return;
    }
    this.openEditor();
  }

  stopEvent(event: Event): boolean {
    return this.source.contains(event.target as Node);
  }

  ignoreMutation(): boolean {
    return true;
  }

  destroy(): void {
    this.destroyed = true;
    this.preview.removeEventListener('wheel', this.handleWheel);
    this.preview.removeEventListener('mousedown', this.handlePreviewMouseDown);
    this.editor?.release(this.owner);
    this.editor = null;
  }

  private openEditor(): void {
    if (this.editor) {
      this.syncSelectionFromView();
      return;
    }
    if (this.initializing) {
      return;
    }
    this.initializing = true;
    // Dynamic import keeps the CodeMirror runtime out of the main chunk
    // (same pattern as code blocks); the module resolves to one shared
    // instance.
    void import('./source-editor')
      .then((module) => module.getSharedMathSourceEditor())
      .then((editor) => {
        this.initializing = false;
        if (this.destroyed) {
          return;
        }
        this.editor = editor;
        this.syncSelectionFromView();
      });
  }

  /**
   * Attach using the current ProseMirror selection — the request that
   * triggered loading may be stale by the time the editor module resolves.
   */
  private syncSelectionFromView(): void {
    const start = this.getPos() + 1;
    const end = start + this.node.content.size;
    const { anchor, head, from, to } = this.view.state.selection;
    if (from < start || to > end) {
      return;
    }
    this.attachAndSelect(anchor - start, head - start);
  }

  private attachAndSelect(anchor: number, head: number): void {
    if (!this.editor) {
      return;
    }
    this.updating = true;
    try {
      this.editor.attach(this.source, this.owner, this.node.textContent);
      this.editor.setSelection(anchor, head);
    } finally {
      this.updating = false;
    }
    // The panel just became visible (or changed owner/height); the preview
    // plugin's view-update hook won't run again until the next transaction.
    positionMathBlockSources(this.view.dom);
  }

  private forwardContentUpdate(): void {
    if (this.updating || !this.editor?.ownedBy(this.owner)) {
      return;
    }

    forwardNestedContentUpdate(
      this.view,
      this.getPos() + 1,
      this.node.textContent,
      this.editor,
    );
  }

  private forwardSelectionUpdate(): void {
    if (this.updating || !this.editor?.ownedBy(this.owner)) {
      return;
    }

    if (this.editor.getValue() !== this.node.textContent) {
      this.forwardContentUpdate();
      return;
    }

    forwardNestedSelectionUpdate(this.view, this.getPos() + 1, this.editor);
  }

  private maybeEscape(
    unit: NestedEditorEscapeUnit,
    dir: NestedEditorDirection,
  ): boolean {
    if (!this.editor?.isCursorAtBoundary(unit, dir)) {
      return false;
    }

    escapeNestedEditor(this.view, this.getPos(), this.node.nodeSize, dir);
    return true;
  }

  /** Enter on the closing `$$` line exits the block, like the PM keymap did. */
  private handleEnter(): boolean {
    if (!exitMathBlock(this.view.state, this.view.dispatch)) {
      return false;
    }
    this.view.focus();
    return true;
  }

  private exitBlock(): void {
    if (exitCode(this.view.state, this.view.dispatch)) {
      this.view.focus();
    }
  }

  /** Backspace once the source is empty removes the block itself. */
  private deleteEmptyBlock(): boolean {
    if (!joinBackward(this.view.state, this.view.dispatch)) {
      return false;
    }
    this.view.focus();
    return true;
  }

  /**
   * Mod-A selects the LaTeX between the `$$` fences (mirroring
   * selectAllInMathBlock) so typing over the selection replaces the formula
   * without dissolving the block.
   */
  private selectAllContent(): boolean {
    if (!this.editor?.ownedBy(this.owner)) {
      return false;
    }
    const lines = parseMathMarkdown(this.node.textContent).lines.filter(
      (line) => line.kind === 'content',
    );
    const first = lines[0];
    const last = lines[lines.length - 1];
    if (!first || !last) {
      return false;
    }
    this.editor.setSelection(first.from, last.to);
    return true;
  }

  private renderPreview(): void {
    this.preview.replaceChildren(
      renderKatex(stripMathDelimiters(this.node.textContent), true),
    );
  }
}

/**
 * The source panel floats below its block by default, but near the end of
 * the document that would extend past the page frame — clipped by the
 * frame's overflow:hidden box, and bait for scrollIntoView to scroll the
 * frame's clip divs (shifting the whole page). Clamp it to the document's
 * extent so it overlays the end of the frame instead, like a popup.
 *
 * Called from the math preview plugin's view-update hook so it runs after
 * every DOM sync — covering selection moves, edits inside the block, and
 * the editable toggle that makes the panel visible in the first place.
 *
 * The bound is the larger of the frame's editor box and the doc element's
 * extent: the editor box covers short documents (the page is taller than
 * the content), while the doc extent covers the flush right after content
 * grows — the frame only resizes to match one rAF later.
 */
export function positionMathBlockSources(viewDom: HTMLElement): void {
  // Horizontal layout flows in columns where vertical clamping makes no
  // sense — keep the CSS default there.
  const editor = viewDom.closest<HTMLElement>(`.${PM_EDITOR_CLASS}`);
  if (!editor || editor.dataset.pageLayout === 'horizontal') {
    return;
  }

  // Frame bottom expressed in the doc element's coordinate space.
  const frameBottom = editor.clientHeight - viewDom.offsetTop - SOURCE_GAP;
  const bound = Math.max(viewDom.clientHeight, frameBottom);

  for (const panel of viewDom.querySelectorAll<HTMLElement>(
    '.pm-math-block--editing .pm-math-block-source',
  )) {
    const block = panel.parentElement;
    const panelHeight = panel.offsetHeight;
    if (!block || panelHeight === 0) {
      continue;
    }

    let blockTop = 0;
    for (
      let el: Element | null = block;
      el instanceof HTMLElement && el !== viewDom;
      el = el.offsetParent
    ) {
      blockTop += el.offsetTop;
    }

    const defaultTop = block.offsetHeight + SOURCE_GAP;
    const maxTop = bound - panelHeight - blockTop;
    const top = `${Math.max(Math.min(defaultTop, maxTop), -blockTop)}px`;
    if (panel.style.top !== top) {
      panel.style.top = top;
    }
  }
}
