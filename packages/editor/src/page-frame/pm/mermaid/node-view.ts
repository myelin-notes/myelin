import { exitCode } from 'prosemirror-commands';
import type { Node as PMNode } from 'prosemirror-model';
import { TextSelection } from 'prosemirror-state';
import type { EditorView, NodeView } from 'prosemirror-view';
import { redo, undo } from 'y-prosemirror';
import { stripFences } from '../code-block/concat';
import type {
  CodeBlockEditor,
  CodeBlockEditorBoundaryInput,
} from '../code-block/editor';
import {
  isClosingFenceLine,
  isOpeningFenceLine,
} from '../markdown/parse-fences';
import type {
  NestedEditorDirection,
  NestedEditorEscapeUnit,
} from '../nested-editor/editor';
import {
  escapeNestedEditor,
  forwardNestedContentUpdate,
  forwardNestedSelectionUpdate,
} from '../nested-editor/pm-sync';
import { positionBlockSourcePanels } from '../nested-editor/source-panel';
import { isMermaidBlock } from './detect';
import { onMermaidThemeChange, renderMermaidSvg } from './render';

const RENDER_DEBOUNCE_MS = 250;

export const MERMAID_SOURCE_PANEL_SELECTOR =
  '.pm-mermaid-block--editing .pm-mermaid-block-source';

/** Line numbers of the ``` fence lines, for the source editor's dimming. */
function fenceDelimiterLines(text: string): readonly number[] {
  const lines = text.split('\n');
  const closingLine = lines.length;
  if (
    !isOpeningFenceLine(lines[0] ?? '') ||
    closingLine <= 1 ||
    !isClosingFenceLine(lines[closingLine - 1])
  ) {
    return [];
  }
  return [1, closingLine];
}

/**
 * Renders a ```mermaid code block as a diagram preview plus a floating
 * raw-source editor, mirroring MathBlockNodeView: the mermaid preview plugin
 * toggles `pm-mermaid-block--editing` on the wrapper (via a node decoration)
 * while the selection is contained in the block, and CSS shows the source
 * panel only then. The node stays an ordinary codeBlock — the node-view
 * factory picks this class from the fence language, and update() returns
 * false when the language changes so ProseMirror rebuilds through the
 * factory (and vice versa in CodeBlockNodeView).
 *
 * Unlike math, the source editor is a per-block CodeBlockEditor created on
 * first edit rather than a shared instance — it reuses the code block's
 * fence-aware markdown grammar and delimiter dimming as-is. The ProseMirror
 * document stays the source of truth via the nested-editor sync helpers.
 */
export class MermaidBlockNodeView implements NodeView {
  dom: HTMLDivElement;
  private preview: HTMLDivElement;
  private source: HTMLDivElement;
  private node: PMNode;
  private editor: CodeBlockEditor | null = null;
  private destroyed = false;
  private updating = false;
  private initializing = false;
  private renderTimer: number | null = null;
  private renderSeq = 0;
  private hasDiagram = false;
  private readonly stopThemeListener: () => void;

  // Without this the canvas pan handler swallows wheel events, so a
  // page-capped preview can never scroll. Only consume the event while the
  // block is being edited, and never for ctrl-wheel (pinch zoom).
  private readonly handleWheel = (event: WheelEvent): void => {
    if (
      event.ctrlKey ||
      !this.dom.classList.contains('pm-mermaid-block--editing')
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

  // Clicking the rendered diagram opens the source editor with the cursor at
  // the end of the source. ProseMirror may skip NodeView.setSelection while
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
    this.dom.className = 'pm-mermaid-block';

    this.preview = document.createElement('div');
    this.preview.className = 'pm-mermaid-block-preview pm-page-capped';
    this.preview.contentEditable = 'false';
    this.preview.addEventListener('wheel', this.handleWheel);
    this.preview.addEventListener('mousedown', this.handlePreviewMouseDown);

    this.source = document.createElement('div');
    this.source.className = 'pm-mermaid-block-source';

    this.dom.append(this.preview, this.source);

    this.stopThemeListener = onMermaidThemeChange(() => {
      void this.renderPreview();
    });
    void this.renderPreview();

    // When a plain code block's language becomes `mermaid`, ProseMirror
    // rebuilds it into this view while the old block's nested CodeMirror still
    // held focus — so the PM view itself isn't focused and ProseMirror skips
    // the setSelection() that would open the source editor. Open it eagerly
    // when the selection already sits inside this block (the just-edited
    // block, or a mermaid block under the cursor on load) so the raw-source
    // editor shows and focuses, mirroring the editor a plain code block
    // creates in its own constructor.
    if (this.isSelectionInside()) {
      this.openEditor();
    }
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) {
      return false;
    }
    if (!isMermaidBlock(node.textContent)) {
      // Language changed — rebuild through the factory as a plain code block.
      return false;
    }

    const changed = node.textContent !== this.node.textContent;
    this.node = node;
    if (changed) {
      this.scheduleRender();
      if (this.editor) {
        if (this.editor.getValue() !== node.textContent) {
          this.updating = true;
          try {
            this.editor.setValue(node.textContent);
          } finally {
            this.updating = false;
          }
        }
        this.editor.setDelimiterLines(fenceDelimiterLines(node.textContent));
      }
    }
    return true;
  }

  setSelection(anchor: number, head: number): void {
    if (!this.editor) {
      this.openEditor();
      return;
    }
    this.updating = true;
    try {
      this.editor.setSelection(anchor, head);
    } finally {
      this.updating = false;
    }
    // The panel just became visible (or changed height); the preview
    // plugin's view-update hook won't run again until the next transaction.
    positionBlockSourcePanels(this.view.dom, MERMAID_SOURCE_PANEL_SELECTOR);
  }

  stopEvent(event: Event): boolean {
    return this.source.contains(event.target as Node);
  }

  ignoreMutation(): boolean {
    return true;
  }

  destroy(): void {
    this.destroyed = true;
    if (this.renderTimer !== null) {
      window.clearTimeout(this.renderTimer);
      this.renderTimer = null;
    }
    this.stopThemeListener();
    this.preview.removeEventListener('wheel', this.handleWheel);
    this.preview.removeEventListener('mousedown', this.handlePreviewMouseDown);
    this.editor?.dispose();
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
    // (same pattern as code blocks).
    void import('../code-block/editor')
      .then(({ CodeBlockEditor }) => {
        this.initializing = false;
        if (this.destroyed) {
          return;
        }
        this.editor = new CodeBlockEditor(this.source, {
          callbacks: {
            onBoundaryInput: (event) => this.handleBoundaryInput(event),
            onContentChange: () => this.forwardContentUpdate(),
            onContentSizeChange: () =>
              positionBlockSourcePanels(
                this.view.dom,
                MERMAID_SOURCE_PANEL_SELECTOR,
              ),
            onEscapeRequest: (unit, dir) => this.maybeEscape(unit, dir),
            onExitBlock: () => this.exitBlock(),
            onRedo: () => {
              redo(this.view.state);
            },
            onSelectionChange: () => this.forwardSelectionUpdate(),
            onUndo: () => {
              undo(this.view.state);
            },
          },
          initialValue: this.node.textContent,
        });
        this.editor.setDelimiterLines(
          fenceDelimiterLines(this.node.textContent),
        );
        this.syncSelectionFromView();
      })
      .catch((error) => {
        // A transient chunk-load failure must not lock the block: clearing
        // the flag lets a later click retry rather than early-returning at
        // the guard forever.
        this.initializing = false;
        console.error('Failed to load mermaid source editor', error);
      });
  }

  /** Whether the current ProseMirror selection is contained in this block. */
  private isSelectionInside(): boolean {
    const start = this.getPos() + 1;
    const end = start + this.node.content.size;
    const { from, to } = this.view.state.selection;
    return from >= start && to <= end;
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
    this.setSelection(anchor - start, head - start);
  }

  private forwardContentUpdate(): void {
    if (this.updating || !this.editor) {
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
    if (this.updating || !this.editor) {
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

  private exitBlock(): void {
    if (exitCode(this.view.state, this.view.dispatch)) {
      this.view.focus();
    }
  }

  private handleBoundaryInput(event: CodeBlockEditorBoundaryInput): void {
    if (!this.shouldMoveInputOutside(event)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.insertAfterBlock(event.key === 'Enter' ? '' : event.key);
  }

  /**
   * Typing at the very end of the closing fence line continues outside the
   * block, mirroring CodeBlockNodeView.shouldMoveInputOutsideCodeBlock.
   */
  private shouldMoveInputOutside(event: CodeBlockEditorBoundaryInput): boolean {
    if (!this.editor?.getSelection().empty) {
      return false;
    }

    const closingLine = fenceDelimiterLines(this.node.textContent)[1];
    if (closingLine === undefined) {
      return false;
    }

    const position = this.editor.getCursorPosition();
    const lineMaxColumn = this.editor.getLineMaxColumn(closingLine);
    if (lineMaxColumn == null) {
      return false;
    }
    if (
      position.lineNumber !== closingLine ||
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

  private insertAfterBlock(text: string): void {
    const insertPos = this.getPos() + this.node.nodeSize;
    const paragraphType = this.view.state.schema.nodes.paragraph;
    let tr = this.view.state.tr;
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
    this.view.dispatch(tr.scrollIntoView());
    this.view.focus();
  }

  private scheduleRender(): void {
    if (this.renderTimer !== null) {
      window.clearTimeout(this.renderTimer);
    }
    // Mermaid parses + lays out the whole diagram per render — too heavy for
    // the keystroke path, so coalesce until typing pauses.
    this.renderTimer = window.setTimeout(() => {
      this.renderTimer = null;
      void this.renderPreview();
    }, RENDER_DEBOUNCE_MS);
  }

  private async renderPreview(): Promise<void> {
    const seq = ++this.renderSeq;
    const source = stripFences(this.node.textContent).trim();

    if (source.length === 0) {
      this.hasDiagram = false;
      this.dom.classList.remove('pm-mermaid-block--error');
      const placeholder = document.createElement('div');
      placeholder.className = 'pm-mermaid-block-placeholder';
      placeholder.textContent = 'Empty diagram';
      this.preview.replaceChildren(placeholder);
      return;
    }

    try {
      const svg = await renderMermaidSvg(source);
      if (this.destroyed || seq !== this.renderSeq) {
        return;
      }
      this.preview.innerHTML = svg;
      this.hasDiagram = true;
      this.dom.classList.remove('pm-mermaid-block--error');
    } catch {
      if (this.destroyed || seq !== this.renderSeq) {
        return;
      }
      // Invalid source: keep the last good diagram dimmed while editing
      // continues; fall back to the raw source when nothing rendered yet so
      // the block's content is never invisible.
      this.dom.classList.add('pm-mermaid-block--error');
      if (!this.hasDiagram) {
        this.preview.textContent = source;
      }
    }
  }
}
