import { exitCode } from 'prosemirror-commands';
import { redo, undo } from 'prosemirror-history';
import type { Node as PMNode } from 'prosemirror-model';
import { TextSelection } from 'prosemirror-state';
import type { EditorView, NodeView } from 'prosemirror-view';
import {
  CODE_BLOCK_CLEAR_SELECTION_EVENT,
  CODE_BLOCK_EXTERNAL_SELECTION_EVENT,
} from '@/lib/events';
import { PM_EDITOR_CLASS } from '../constants';
import { isOpeningFenceLine } from '../markdown/parse-fences';
import type {
  NestedEditorDirection,
  NestedEditorEscapeUnit,
} from '../nested-editor/editor';
import {
  escapeNestedEditor,
  forwardNestedContentUpdate,
  forwardNestedSelectionUpdate,
} from '../nested-editor/pm-sync';
import { collectRunSource, parseBlockLanguage } from './concat';
import type { CodeBlockEditor, CodeBlockEditorBoundaryInput } from './editor';
import { CodeBlockRunView } from './run-view';
import {
  type CodeBlockExternalSelection,
  type CodeBlockExternalSelectionDetail,
  getCodeBlockExternalSelection,
} from './selection-sync';

interface FenceSource {
  closingFenceLine: number | null;
  delimiterLines: readonly number[];
}

function parseFenceSource(text: string): FenceSource {
  const lines = text.split('\n');
  const closingFenceLine = lines.length;

  if (
    !isOpeningFenceLine(lines[0]) ||
    closingFenceLine <= 1 ||
    lines[closingFenceLine - 1] !== '```'
  ) {
    return {
      closingFenceLine: null,
      delimiterLines: [],
    };
  }

  return {
    closingFenceLine,
    delimiterLines: [1, closingFenceLine],
  };
}

export class CodeBlockNodeView implements NodeView {
  public readonly dom: HTMLDivElement;

  private readonly editorEl: HTMLDivElement;
  private readonly runView: CodeBlockRunView;
  private editor: CodeBlockEditor | null = null;
  private layoutObserver: MutationObserver | null = null;
  private destroyed = false;
  private selectionDragStartedOutside = false;
  private updating = false;
  private readonly handleViewMouseDown = (event: MouseEvent): void => {
    if (event.button !== 0) {
      return;
    }

    this.selectionDragStartedOutside = !this.dom.contains(event.target as Node);
    if (this.selectionDragStartedOutside) {
      this.clearEditorSelection();
    }
  };
  private readonly handleCodeBlockMouseUp = (event: MouseEvent): void => {
    if (!this.selectionDragStartedOutside || event.button !== 0) {
      return;
    }

    this.selectionDragStartedOutside = false;
    if (!this.selectThroughMousePoint(event.clientX, event.clientY)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
  };
  private readonly handleCodeBlockMouseMove = (event: MouseEvent): void => {
    if (!this.selectionDragStartedOutside) {
      return;
    }

    if ((event.buttons & 1) === 0) {
      this.selectionDragStartedOutside = false;
      return;
    }

    if (!this.selectThroughMousePoint(event.clientX, event.clientY)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
  };
  private readonly handleExternalSelection = (event: Event): void => {
    const { detail } = event as CustomEvent<CodeBlockExternalSelectionDetail>;
    this.setExternalSelection(detail);
  };
  private readonly handleClearSelection = (): void => {
    this.clearEditorSelection();
  };

  constructor(
    private node: PMNode,
    private view: EditorView,
    private getPos: () => number,
  ) {
    this.dom = document.createElement('div');
    this.dom.className = 'pm-code-block';
    this.dom.addEventListener(
      CODE_BLOCK_EXTERNAL_SELECTION_EVENT,
      this.handleExternalSelection,
    );
    this.dom.addEventListener(
      CODE_BLOCK_CLEAR_SELECTION_EVENT,
      this.handleClearSelection,
    );
    this.dom.addEventListener('mouseup', this.handleCodeBlockMouseUp, true);
    this.dom.addEventListener('mousemove', this.handleCodeBlockMouseMove, true);
    this.view.dom.addEventListener('mousedown', this.handleViewMouseDown, true);

    this.editorEl = document.createElement('div');
    this.editorEl.className = 'pm-code-block__editor';
    this.dom.appendChild(this.editorEl);

    this.runView = new CodeBlockRunView({
      view: this.view,
      blockDom: this.dom,
      collectSource: () => collectRunSource(this.view.state.doc, this.getPos()),
    });
    this.dom.appendChild(this.runView.chip);
    this.runView.setLanguage(parseBlockLanguage(this.node.textContent));

    // The .pm-page-capped max-height tracks data-page-layout, which the frame
    // can flip after this view mounts (e.g. switching to continuous in
    // settings) — re-measure the outer height when it does.
    const layoutHost = this.view.dom.closest(`.${PM_EDITOR_CLASS}`);
    if (layoutHost) {
      this.layoutObserver = new MutationObserver(() => this.syncHeight());
      this.layoutObserver.observe(layoutHost, {
        attributes: true,
        attributeFilter: ['data-page-layout'],
      });
    }

    void this.initEditor();
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) {
      return false;
    }

    this.node = node;
    this.runView.setLanguage(parseBlockLanguage(node.textContent));

    if (!this.editor) {
      return true;
    }

    const source = parseFenceSource(node.textContent);
    if (this.editor.getValue() !== node.textContent) {
      this.updating = true;
      this.editor.setValue(node.textContent);
      this.updating = false;
    }

    this.syncPresentation(source);
    this.syncHeight();
    return true;
  }

  setSelection(anchor: number, head: number): void {
    if (!this.editor) {
      return;
    }

    this.updating = true;
    this.editor.setSelection(anchor, head);
    this.updating = false;
  }

  selectNode(): void {
    this.editor?.focus();
  }

  stopEvent(event: Event): boolean {
    return this.dom.contains(event.target as Node);
  }

  ignoreMutation(): boolean {
    return true;
  }

  destroy(): void {
    this.destroyed = true;
    this.runView.dispose();
    this.layoutObserver?.disconnect();
    this.layoutObserver = null;
    this.dom.removeEventListener(
      CODE_BLOCK_EXTERNAL_SELECTION_EVENT,
      this.handleExternalSelection,
    );
    this.dom.removeEventListener(
      CODE_BLOCK_CLEAR_SELECTION_EVENT,
      this.handleClearSelection,
    );
    this.dom.removeEventListener('mouseup', this.handleCodeBlockMouseUp, true);
    this.dom.removeEventListener(
      'mousemove',
      this.handleCodeBlockMouseMove,
      true,
    );
    this.view.dom.removeEventListener(
      'mousedown',
      this.handleViewMouseDown,
      true,
    );
    this.editor?.dispose();
    this.editor = null;
  }

  private async initEditor(): Promise<void> {
    // Dynamic import keeps the CodeMirror runtime out of the main chunk; it
    // only loads when the first code block renders.
    const { CodeBlockEditor } = await import('./editor');
    const editor = new CodeBlockEditor(this.editorEl, {
      callbacks: {
        onBoundaryInput: (event) => this.handleBoundaryKeyDown(event),
        onContentChange: () => this.forwardContentUpdate(),
        onContentSizeChange: () => this.syncHeight(),
        onEscapeRequest: (unit, dir) => this.maybeEscape(unit, dir),
        onExitBlock: () => this.exitCodeBlock(),
        onRedo: () => redo(this.view.state, this.view.dispatch),
        onSelectionChange: () => this.forwardSelectionUpdate(),
        onUndo: () => undo(this.view.state, this.view.dispatch),
      },
      initialValue: this.node.textContent,
    });

    if (this.destroyed) {
      editor.dispose();
      return;
    }

    this.editor = editor;
    const latestSource = parseFenceSource(this.node.textContent);
    if (this.editor.getValue() !== this.node.textContent) {
      this.updating = true;
      this.editor.setValue(this.node.textContent);
      this.updating = false;
    }
    this.syncPresentation(latestSource);
    this.syncHeight();
    this.syncSelectionFromView();
    this.syncExternalSelectionFromView();
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

  private selectThroughMousePoint(clientX: number, clientY: number): boolean {
    const offset = this.editor?.getOffsetAtClientPoint(clientX, clientY);
    if (offset == null) {
      return false;
    }

    const endPos = this.getPos() + 1 + offset;
    const anchor = this.view.state.selection.anchor;
    this.view.dispatch(
      this.view.state.tr.setSelection(
        TextSelection.create(this.view.state.doc, anchor, endPos),
      ),
    );
    return true;
  }

  private clearEditorSelection(): void {
    this.updating = true;
    try {
      this.editor?.clearSelection();
    } finally {
      this.updating = false;
    }
  }

  private handleBoundaryKeyDown(event: CodeBlockEditorBoundaryInput): void {
    if (!this.shouldMoveInputOutsideCodeBlock(event)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.insertAfterCodeBlock(event.key === 'Enter' ? '' : event.key);
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

  private shouldMoveInputOutsideCodeBlock(
    event: CodeBlockEditorBoundaryInput,
  ): boolean {
    if (!this.editor) {
      return false;
    }

    const selection = this.editor.getSelection();
    if (!selection.empty) {
      return false;
    }

    const source = parseFenceSource(this.node.textContent);
    if (source.closingFenceLine == null) {
      return false;
    }

    const position = this.editor.getCursorPosition();
    const lineMaxColumn = this.editor.getLineMaxColumn(source.closingFenceLine);
    if (lineMaxColumn == null) {
      return false;
    }
    if (
      position.lineNumber !== source.closingFenceLine ||
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

  private insertAfterCodeBlock(text: string): void {
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

  private exitCodeBlock(): void {
    if (exitCode(this.view.state, this.view.dispatch)) {
      this.view.focus();
    }
  }

  private syncPresentation(source: FenceSource): void {
    if (!this.editor) {
      return;
    }

    this.editor.setDelimiterLines(source.delimiterLines);
  }

  private syncSelectionFromView(): void {
    const start = this.getPos() + 1;
    const end = start + this.node.content.size;
    const { from, to } = this.view.state.selection;
    if (from < start || to > end) {
      return;
    }
    this.setSelection(from - start, to - start);
  }

  private setExternalSelection(
    selection: CodeBlockExternalSelection | null,
  ): void {
    const visibleSelection = this.isEditorOwnedSelection(selection)
      ? null
      : selection;
    this.editor?.setExternalSelection(visibleSelection);
  }

  private isEditorOwnedSelection(
    selection: CodeBlockExternalSelection | null,
  ): boolean {
    if (!selection || !this.editor?.hasTextFocus()) {
      return false;
    }

    const editorSelection = this.editor.getSelection();
    return (
      editorSelection.from === selection.from &&
      editorSelection.to === selection.to
    );
  }

  private syncExternalSelectionFromView(): void {
    if (!this.editor) {
      return;
    }

    const start = this.getPos() + 1;
    const end = start + this.node.content.size;
    const { from, to } = this.view.state.selection;
    this.setExternalSelection(
      getCodeBlockExternalSelection(from, to, start, end),
    );
  }

  private syncHeight(): void {
    if (!this.editor) {
      return;
    }

    const layout = this.editor.syncLayout();
    this.dom.style.height = `${layout.outerHeightPx + this.runView.chipHeight()}px`;
  }
}
