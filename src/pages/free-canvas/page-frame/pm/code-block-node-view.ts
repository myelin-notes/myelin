import { exitCode } from 'prosemirror-commands';
import { redo, undo } from 'prosemirror-history';
import type { Node as PMNode } from 'prosemirror-model';
import { Selection, TextSelection } from 'prosemirror-state';
import type { EditorView, NodeView } from 'prosemirror-view';
import type { MonacoApi } from './monaco-runtime';
import { schema } from './schema';

const OPENING_FENCE_RE = /^```(\w+)?$/;
const MONACO_LANGUAGE_BY_FENCE: Record<string, string> = {
  c: 'c',
  cpp: 'cpp',
  cs: 'csharp',
  css: 'css',
  go: 'go',
  htm: 'html',
  html: 'html',
  java: 'java',
  js: 'javascript',
  json: 'json',
  jsx: 'javascript',
  md: 'markdown',
  py: 'python',
  php: 'php',
  rs: 'rust',
  sh: 'shell',
  shell: 'shell',
  sql: 'sql',
  ts: 'typescript',
  tsx: 'typescript',
  xml: 'xml',
  yml: 'yaml',
};

interface FenceSource {
  closingFenceLine: number | null;
  language: string | null;
  openingFenceLine: number | null;
  usesFence: boolean;
}

type MonacoModule = typeof import('./monaco-runtime');

function parseFenceSource(text: string): FenceSource {
  const lines = text.split('\n');
  const openingFence = lines[0] ?? null;
  const closingFence =
    lines.length > 1 ? (lines[lines.length - 1] ?? null) : null;
  const hasFence =
    openingFence != null &&
    closingFence === '```' &&
    OPENING_FENCE_RE.test(openingFence);

  if (!hasFence || !openingFence || !closingFence) {
    return {
      closingFenceLine: null,
      language: null,
      openingFenceLine: null,
      usesFence: false,
    };
  }

  const language = OPENING_FENCE_RE.exec(openingFence)?.[1] ?? null;

  return {
    closingFenceLine: lines.length,
    language,
    openingFenceLine: 1,
    usesFence: true,
  };
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
    to: currentEnd,
    insert: next.slice(start, nextEnd),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function resolveMonacoLanguage(language: string | null): string {
  if (!language) {
    return 'plaintext';
  }
  const normalized = language.toLowerCase();
  return MONACO_LANGUAGE_BY_FENCE[normalized] ?? normalized;
}

export class CodeBlockNodeView implements NodeView {
  private static monacoPromise: Promise<MonacoApi> | null = null;

  public readonly dom: HTMLDivElement;

  private readonly editorEl: HTMLDivElement;
  private editor: import('monaco-editor').editor.IStandaloneCodeEditor | null =
    null;
  private decorations:
    | import('monaco-editor').editor.IEditorDecorationsCollection
    | null = null;
  private model: import('monaco-editor').editor.ITextModel | null = null;
  private monaco: MonacoApi | null = null;
  private destroyed = false;
  private updating = false;

  constructor(
    private node: PMNode,
    private view: EditorView,
    private getPos: () => number,
  ) {
    this.dom = document.createElement('div');
    this.dom.className = 'pm-monaco-code-block';

    this.editorEl = document.createElement('div');
    this.editorEl.className = 'pm-monaco-code-block__editor';
    this.dom.appendChild(this.editorEl);

    void this.initMonaco();
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) {
      return false;
    }

    this.node = node;

    if (!this.editor || !this.model || !this.monaco) {
      return true;
    }

    const source = parseFenceSource(node.textContent);
    const currentValue = this.model.getValue(
      this.monaco.editor.EndOfLinePreference.LF,
    );
    if (currentValue !== node.textContent) {
      this.updating = true;
      this.model.setValue(node.textContent);
      this.updating = false;
    }

    this.syncPresentation(source);
    this.syncHeight();
    return true;
  }

  setSelection(anchor: number, head: number): void {
    if (!this.editor || !this.model || !this.monaco) {
      return;
    }

    const maxOffset = this.node.textContent.length;
    const anchorPos = this.model.getPositionAt(clamp(anchor, 0, maxOffset));
    const headPos = this.model.getPositionAt(clamp(head, 0, maxOffset));

    this.editor.focus();
    this.updating = true;
    this.editor.setSelection(
      new this.monaco.Selection(
        anchorPos.lineNumber,
        anchorPos.column,
        headPos.lineNumber,
        headPos.column,
      ),
    );
    this.editor.revealPositionInCenterIfOutsideViewport(headPos);
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
    this.decorations?.clear();
    this.decorations = null;
    this.editor?.dispose();
    this.model?.dispose();
    this.editor = null;
    this.model = null;
    this.monaco = null;
  }

  private async initMonaco(): Promise<void> {
    if (!CodeBlockNodeView.monacoPromise) {
      CodeBlockNodeView.monacoPromise = import('./monaco-runtime').then(
        (module: MonacoModule) => module.getMonaco(),
      );
    }

    const monaco = await CodeBlockNodeView.monacoPromise;
    if (this.destroyed) {
      return;
    }

    this.monaco = monaco;
    const source = parseFenceSource(this.node.textContent);
    this.model = monaco.editor.createModel(
      this.node.textContent,
      resolveMonacoLanguage(source.language),
    );

    this.editor = monaco.editor.create(this.editorEl, {
      automaticLayout: true,
      bracketPairColorization: { enabled: false },
      contextmenu: true,
      fixedOverflowWidgets: false,
      folding: false,
      fontFamily:
        '"SFMono-Regular", "SF Mono", ui-monospace, "Cascadia Code", "Source Code Pro", Menlo, Consolas, monospace',
      fontSize: 14,
      glyphMargin: false,
      lineDecorationsWidth: 12,
      lineNumbers: 'on',
      lineNumbersMinChars: 3,
      minimap: { enabled: false },
      model: this.model,
      overviewRulerBorder: false,
      overviewRulerLanes: 0,
      padding: { top: 14, bottom: 14 },
      readOnly: false,
      renderLineHighlight: 'none',
      roundedSelection: true,
      scrollBeyondLastLine: false,
      scrollbar: {
        alwaysConsumeMouseWheel: false,
        handleMouseWheel: false,
        horizontal: 'hidden',
        vertical: 'hidden',
      },
      theme: 'myelin-code-block',
      wordWrap: 'off',
    });
    this.decorations = this.editor.createDecorationsCollection();

    this.editor.onDidChangeModelContent(() => this.forwardUpdate());
    this.editor.onDidChangeCursorSelection(() => this.forwardUpdate());
    this.editor.onDidContentSizeChange(() => this.syncHeight());
    this.editor.onKeyDown((event) => this.handleBoundaryKeyDown(event));

    this.editor.addCommand(monaco.KeyCode.UpArrow, () => {
      if (!this.maybeEscape('line', -1)) {
        this.editor?.trigger('keyboard', 'cursorUp', null);
      }
    });
    this.editor.addCommand(monaco.KeyCode.DownArrow, () => {
      if (!this.maybeEscape('line', 1)) {
        this.editor?.trigger('keyboard', 'cursorDown', null);
      }
    });
    this.editor.addCommand(monaco.KeyCode.LeftArrow, () => {
      if (!this.maybeEscape('char', -1)) {
        this.editor?.trigger('keyboard', 'cursorLeft', null);
      }
    });
    this.editor.addCommand(monaco.KeyCode.RightArrow, () => {
      if (!this.maybeEscape('char', 1)) {
        this.editor?.trigger('keyboard', 'cursorRight', null);
      }
    });
    this.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      if (exitCode(this.view.state, this.view.dispatch)) {
        this.view.focus();
      }
    });
    this.editor.addCommand(monaco.KeyMod.Shift | monaco.KeyCode.Enter, () => {
      if (exitCode(this.view.state, this.view.dispatch)) {
        this.view.focus();
      }
    });
    this.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyZ, () => {
      undo(this.view.state, this.view.dispatch);
    });
    this.editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyZ,
      () => {
        redo(this.view.state, this.view.dispatch);
      },
    );
    this.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyY, () => {
      redo(this.view.state, this.view.dispatch);
    });

    this.syncPresentation(source);
    this.syncHeight();
    this.syncSelectionFromView();
  }

  private forwardUpdate(): void {
    if (
      this.updating ||
      !this.editor ||
      !this.model ||
      !this.monaco ||
      !this.editor.hasTextFocus()
    ) {
      return;
    }

    const nextText = this.model.getValue(
      this.monaco.editor.EndOfLinePreference.LF,
    );
    const selection = this.editor.getSelection();
    if (!selection) {
      return;
    }

    const offset = this.getPos() + 1;
    const selFrom =
      offset + this.model.getOffsetAt(selection.getStartPosition());
    const selTo = offset + this.model.getOffsetAt(selection.getEndPosition());
    const pmSelection = this.view.state.selection;
    const diff = findTextDiff(this.node.textContent, nextText);

    if (!diff && pmSelection.from === selFrom && pmSelection.to === selTo) {
      return;
    }

    const tr = this.view.state.tr;
    if (diff) {
      if (diff.insert.length > 0) {
        tr.replaceWith(
          offset + diff.from,
          offset + diff.to,
          schema.text(diff.insert),
        );
      } else {
        tr.delete(offset + diff.from, offset + diff.to);
      }
    }
    tr.setSelection(TextSelection.create(tr.doc, selFrom, selTo));
    this.view.dispatch(tr);
  }

  private handleBoundaryKeyDown(
    event: import('monaco-editor').IKeyboardEvent,
  ): void {
    if (!this.shouldMoveInputOutsideCodeBlock(event)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.insertAfterCodeBlock(
      event.browserEvent.key === 'Enter' ? '' : event.browserEvent.key,
    );
  }

  private maybeEscape(unit: 'char' | 'line', dir: -1 | 1): boolean {
    if (!this.editor || !this.model) {
      return false;
    }

    const selection = this.editor.getSelection();
    if (!selection?.isEmpty()) {
      return false;
    }

    const position = selection.getPosition();
    if (unit === 'line') {
      const edgeLine = dir < 0 ? 1 : this.model.getLineCount();
      if (position.lineNumber !== edgeLine) {
        return false;
      }
    } else {
      const offset = this.model.getOffsetAt(position);
      if (dir < 0 ? offset > 0 : offset < this.model.getValueLength()) {
        return false;
      }
    }

    const targetPos = this.getPos() + (dir < 0 ? 0 : this.node.nodeSize);
    const nextSelection = Selection.near(
      this.view.state.doc.resolve(targetPos),
      dir,
    );
    const tr = this.view.state.tr.setSelection(nextSelection).scrollIntoView();
    this.view.dispatch(tr);
    this.view.focus();
    return true;
  }

  private shouldMoveInputOutsideCodeBlock(
    event: import('monaco-editor').IKeyboardEvent,
  ): boolean {
    if (!this.editor || !this.model) {
      return false;
    }

    const selection = this.editor.getSelection();
    if (!selection?.isEmpty()) {
      return false;
    }

    const source = parseFenceSource(this.node.textContent);
    if (!source.usesFence || !source.closingFenceLine) {
      return false;
    }

    const position = selection.getPosition();
    const lineMaxColumn = this.model.getLineMaxColumn(source.closingFenceLine);
    if (
      position.lineNumber !== source.closingFenceLine ||
      position.column !== lineMaxColumn
    ) {
      return false;
    }

    const { key, isComposing } = event.browserEvent;
    if (isComposing || event.ctrlKey || event.metaKey || event.altKey) {
      return false;
    }

    if (key === 'Enter') {
      return true;
    }

    return key.length === 1;
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

  private syncPresentation(source: FenceSource): void {
    if (!this.model || !this.monaco) {
      return;
    }

    const nextLanguage = resolveMonacoLanguage(source.language);
    if (this.model.getLanguageId() !== nextLanguage) {
      this.monaco.editor.setModelLanguage(this.model, nextLanguage);
    }

    this.syncDelimiterDecorations(source);
  }

  private syncDelimiterDecorations(source: FenceSource): void {
    if (!this.decorations || !this.model || !source.usesFence) {
      this.decorations?.set([]);
      return;
    }

    const ranges: import('monaco-editor').editor.IModelDeltaDecoration[] = [];
    if (source.openingFenceLine) {
      ranges.push(this.createDelimiterDecoration(source.openingFenceLine));
    }
    if (
      source.closingFenceLine &&
      source.closingFenceLine !== source.openingFenceLine
    ) {
      ranges.push(this.createDelimiterDecoration(source.closingFenceLine));
    }
    this.decorations.set(ranges);
  }

  private createDelimiterDecoration(
    lineNumber: number,
  ): import('monaco-editor').editor.IModelDeltaDecoration {
    if (!this.model || !this.monaco) {
      throw new Error('Monaco model unavailable for delimiter decoration');
    }

    return {
      options: {
        inlineClassName: 'pm-monaco-code-block__delimiter',
      },
      range: new this.monaco.Range(
        lineNumber,
        1,
        lineNumber,
        this.model.getLineMaxColumn(lineNumber),
      ),
    };
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

  private syncHeight(): void {
    if (!this.editor) {
      return;
    }

    const height = Math.max(72, Math.ceil(this.editor.getContentHeight()));
    this.editorEl.style.height = `${height}px`;
    this.editor.layout({ height, width: this.editorEl.clientWidth });
  }
}
