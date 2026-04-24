import type { CodeBlockExternalSelection } from './code-block-selection-sync';
import type { MonacoApi } from './monaco-runtime';

export type CodeBlockEditorDirection = -1 | 1;

export type CodeBlockEditorEscapeUnit = 'char' | 'line';

interface CodeBlockEditorSelection {
  empty: boolean;
  from: number;
  to: number;
}

interface CodeBlockEditorCursorPosition {
  column: number;
  lineNumber: number;
}

export interface CodeBlockEditorBoundaryInput {
  altKey: boolean;
  ctrlKey: boolean;
  isComposing: boolean;
  key: string;
  metaKey: boolean;
  preventDefault: () => void;
  stopPropagation: () => void;
}

interface CodeBlockEditorLayout {
  outerHeightPx: number;
}

interface CodeBlockEditorCallbacks {
  onBoundaryInput: (event: CodeBlockEditorBoundaryInput) => void;
  onContentChange: () => void;
  onContentSizeChange: () => void;
  onEscapeRequest: (
    unit: CodeBlockEditorEscapeUnit,
    dir: CodeBlockEditorDirection,
  ) => boolean;
  onExitCodeBlock: () => void;
  onRedo: () => void;
  onSelectionChange: () => void;
  onUndo: () => void;
}

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

type MonacoModule = typeof import('./monaco-runtime');

let monacoPromise: Promise<MonacoApi> | null = null;

interface MonacoCodeBlockEditorOptions {
  callbacks: CodeBlockEditorCallbacks;
  initialLanguage: string | null;
  initialValue: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function loadMonaco(): Promise<MonacoApi> {
  if (!monacoPromise) {
    monacoPromise = import('./monaco-runtime').then((module: MonacoModule) =>
      module.getMonaco(),
    );
  }
  return monacoPromise;
}

function resolveMonacoLanguage(language: string | null): string {
  if (!language) {
    return 'plaintext';
  }
  const normalized = language.toLowerCase();
  return MONACO_LANGUAGE_BY_FENCE[normalized] ?? normalized;
}

export class MonacoCodeBlockEditor {
  private readonly delimiterDecorations: import('monaco-editor').editor.IEditorDecorationsCollection;
  private readonly editor: import('monaco-editor').editor.IStandaloneCodeEditor;
  private readonly externalSelectionDecorations: import('monaco-editor').editor.IEditorDecorationsCollection;
  private readonly model: import('monaco-editor').editor.ITextModel;

  constructor(
    private readonly monaco: MonacoApi,
    private readonly editorEl: HTMLDivElement,
    options: MonacoCodeBlockEditorOptions,
  ) {
    this.model = monaco.editor.createModel(
      options.initialValue,
      resolveMonacoLanguage(options.initialLanguage),
    );

    this.editor = monaco.editor.create(this.editorEl, {
      automaticLayout: true,
      bracketPairColorization: { enabled: false },
      contextmenu: true,
      fixedOverflowWidgets: false,
      folding: false,
      fontFamily:
        '"SFMono-Regular", "SF Mono", ui-monospace, "Cascadia Code", "Source Code Pro", Menlo, Consolas, monospace',
      fontSize: 14 * (window.devicePixelRatio || 1),
      glyphMargin: false,
      lineDecorationsWidth: 12 * (window.devicePixelRatio || 1),
      lineNumbers: 'on',
      lineNumbersMinChars: 3,
      minimap: { enabled: false },
      model: this.model,
      overviewRulerBorder: false,
      overviewRulerLanes: 0,
      padding: {
        bottom: 14 * (window.devicePixelRatio || 1),
        top: 14 * (window.devicePixelRatio || 1),
      },
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
    this.delimiterDecorations = this.editor.createDecorationsCollection();
    this.externalSelectionDecorations =
      this.editor.createDecorationsCollection();

    this.editor.onDidChangeModelContent(() =>
      options.callbacks.onContentChange(),
    );
    this.editor.onDidChangeCursorSelection(() =>
      options.callbacks.onSelectionChange(),
    );
    this.editor.onDidContentSizeChange(() =>
      options.callbacks.onContentSizeChange(),
    );
    this.editor.onKeyDown((event) => {
      options.callbacks.onBoundaryInput({
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        isComposing: event.browserEvent.isComposing,
        key: event.browserEvent.key,
        metaKey: event.metaKey,
        preventDefault: () => event.preventDefault(),
        stopPropagation: () => event.stopPropagation(),
      });
    });
    this.editor.onMouseDown(() => {
      requestAnimationFrame(() => options.callbacks.onSelectionChange());
    });
    this.editor.onMouseUp(() => {
      requestAnimationFrame(() => options.callbacks.onSelectionChange());
    });

    this.addEscapeCommand(
      monaco.KeyCode.UpArrow,
      'line',
      -1,
      'cursorUp',
      options,
    );
    this.addEscapeCommand(
      monaco.KeyCode.DownArrow,
      'line',
      1,
      'cursorDown',
      options,
    );
    this.addEscapeCommand(
      monaco.KeyCode.LeftArrow,
      'char',
      -1,
      'cursorLeft',
      options,
    );
    this.addEscapeCommand(
      monaco.KeyCode.RightArrow,
      'char',
      1,
      'cursorRight',
      options,
    );
    this.editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
      options.callbacks.onExitCodeBlock,
    );
    this.editor.addCommand(
      monaco.KeyMod.Shift | monaco.KeyCode.Enter,
      options.callbacks.onExitCodeBlock,
    );
    this.editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyZ,
      options.callbacks.onUndo,
    );
    this.editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyZ,
      options.callbacks.onRedo,
    );
    this.editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyY,
      options.callbacks.onRedo,
    );
  }

  getValue(): string {
    return this.model.getValue(this.monaco.editor.EndOfLinePreference.LF);
  }

  setValue(value: string): void {
    this.model.setValue(value);
  }

  getSelection(): CodeBlockEditorSelection | null {
    const selection = this.editor.getSelection();
    if (!selection) {
      return null;
    }
    return {
      empty: selection.isEmpty(),
      from: this.model.getOffsetAt(selection.getStartPosition()),
      to: this.model.getOffsetAt(selection.getEndPosition()),
    };
  }

  setSelection(anchor: number, head: number): void {
    const maxOffset = this.model.getValueLength();
    const anchorPos = this.model.getPositionAt(clamp(anchor, 0, maxOffset));
    const headPos = this.model.getPositionAt(clamp(head, 0, maxOffset));

    this.editor.focus();
    this.editor.setSelection(
      new this.monaco.Selection(
        anchorPos.lineNumber,
        anchorPos.column,
        headPos.lineNumber,
        headPos.column,
      ),
    );
    this.editor.revealPositionInCenterIfOutsideViewport(headPos);
  }

  clearSelection(): void {
    this.externalSelectionDecorations.clear();

    const selection = this.editor.getSelection();
    if (!selection || selection.isEmpty()) {
      return;
    }

    this.editor.setPosition(selection.getPosition());
  }

  focus(): void {
    this.editor.focus();
  }

  hasTextFocus(): boolean {
    return this.editor.hasTextFocus();
  }

  setLanguage(language: string | null): void {
    const nextLanguage = resolveMonacoLanguage(language);
    if (this.model.getLanguageId() !== nextLanguage) {
      this.monaco.editor.setModelLanguage(this.model, nextLanguage);
    }
  }

  setDelimiterLines(lineNumbers: readonly number[]): void {
    this.delimiterDecorations.set(
      lineNumbers.map((lineNumber) => ({
        options: {
          inlineClassName: 'pm-monaco-code-block__delimiter',
        },
        range: new this.monaco.Range(
          lineNumber,
          1,
          lineNumber,
          this.model.getLineMaxColumn(lineNumber),
        ),
      })),
    );
  }

  setExternalSelection(selection: CodeBlockExternalSelection | null): void {
    if (!selection || selection.from === selection.to) {
      this.externalSelectionDecorations.clear();
      return;
    }

    const maxOffset = this.model.getValueLength();
    const from = clamp(Math.min(selection.from, selection.to), 0, maxOffset);
    const to = clamp(Math.max(selection.from, selection.to), 0, maxOffset);
    if (from === to) {
      this.externalSelectionDecorations.clear();
      return;
    }

    const start = this.model.getPositionAt(from);
    const end = this.model.getPositionAt(to);
    this.externalSelectionDecorations.set([
      {
        options: {
          inlineClassName: 'pm-monaco-code-block__external-selection',
        },
        range: new this.monaco.Range(
          start.lineNumber,
          start.column,
          end.lineNumber,
          end.column,
        ),
      },
    ]);
  }

  getCursorPosition(): CodeBlockEditorCursorPosition | null {
    const selection = this.editor.getSelection();
    return selection?.getPosition() ?? null;
  }

  getLineMaxColumn(lineNumber: number): number | null {
    if (lineNumber < 1 || lineNumber > this.model.getLineCount()) {
      return null;
    }
    return this.model.getLineMaxColumn(lineNumber);
  }

  getOffsetAtClientPoint(left: number, top: number): number | null {
    const position = this.editor.getTargetAtClientPoint(left, top)?.position;
    return position ? this.model.getOffsetAt(position) : null;
  }

  isCursorAtBoundary(
    unit: CodeBlockEditorEscapeUnit,
    dir: CodeBlockEditorDirection,
  ): boolean {
    const selection = this.editor.getSelection();
    if (!selection?.isEmpty()) {
      return false;
    }

    const position = selection.getPosition();
    if (unit === 'line') {
      const edgeLine = dir < 0 ? 1 : this.model.getLineCount();
      return position.lineNumber === edgeLine;
    }

    const offset = this.model.getOffsetAt(position);
    return dir < 0 ? offset === 0 : offset === this.model.getValueLength();
  }

  syncLayout(): CodeBlockEditorLayout {
    const scale = window.devicePixelRatio || 1;
    const height = Math.max(72, Math.ceil(this.editor.getContentHeight()));
    this.editorEl.style.height = `${height}px`;
    this.editor.layout({ height, width: this.editorEl.clientWidth });
    return { outerHeightPx: height / scale };
  }

  dispose(): void {
    this.delimiterDecorations.clear();
    this.externalSelectionDecorations.clear();
    this.editor.dispose();
    this.model.dispose();
  }

  private addEscapeCommand(
    keyCode: number,
    unit: CodeBlockEditorEscapeUnit,
    dir: CodeBlockEditorDirection,
    fallbackCommand: string,
    options: MonacoCodeBlockEditorOptions,
  ): void {
    this.editor.addCommand(keyCode, () => {
      if (!options.callbacks.onEscapeRequest(unit, dir)) {
        this.editor.trigger('keyboard', fallbackCommand, null);
      }
    });
  }
}

export async function createMonacoCodeBlockEditor(
  editorEl: HTMLDivElement,
  options: MonacoCodeBlockEditorOptions,
): Promise<MonacoCodeBlockEditor> {
  const monaco = await loadMonaco();
  return new MonacoCodeBlockEditor(monaco, editorEl, options);
}
