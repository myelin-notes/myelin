import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { syntaxHighlighting } from '@codemirror/language';
import {
  EditorSelection,
  type Extension,
  Prec,
  StateEffect,
  StateField,
} from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  type KeyBinding,
  keymap,
  lineNumbers,
  type ViewUpdate,
} from '@codemirror/view';
import type { CodeBlockExternalSelection } from './selection-sync';
import {
  codeBlockEditorTheme,
  codeBlockHighlightStyle,
  codeBlockLanguage,
} from './theme';

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

interface CodeBlockEditorLayoutOptions {
  maxOuterHeightPx?: number;
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

interface CodeBlockEditorOptions {
  callbacks: CodeBlockEditorCallbacks;
  initialValue: string;
}

const MIN_OUTER_HEIGHT_PX = 72;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

const setDelimiterLines = StateEffect.define<readonly number[]>();
const setExternalSelectionEffect =
  StateEffect.define<CodeBlockExternalSelection | null>();

const delimiterField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, tr) {
    let next = decorations.map(tr.changes);
    for (const effect of tr.effects) {
      if (!effect.is(setDelimiterLines)) {
        continue;
      }
      const ranges = [];
      for (const lineNumber of effect.value) {
        if (lineNumber < 1 || lineNumber > tr.state.doc.lines) {
          continue;
        }
        const line = tr.state.doc.line(lineNumber);
        if (line.length === 0) {
          continue;
        }
        ranges.push(
          Decoration.mark({ class: 'pm-code-block__delimiter' }).range(
            line.from,
            line.to,
          ),
        );
      }
      next = Decoration.set(ranges, true);
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const externalSelectionField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, tr) {
    let next = decorations.map(tr.changes);
    for (const effect of tr.effects) {
      if (!effect.is(setExternalSelectionEffect)) {
        continue;
      }
      const selection = effect.value;
      const length = tr.state.doc.length;
      const from = selection
        ? clamp(Math.min(selection.from, selection.to), 0, length)
        : 0;
      const to = selection
        ? clamp(Math.max(selection.from, selection.to), 0, length)
        : 0;
      next =
        selection && from < to
          ? Decoration.set([
              Decoration.mark({
                class: 'pm-code-block__external-selection',
              }).range(from, to),
            ])
          : Decoration.none;
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export class CodeBlockEditor {
  private readonly view: EditorView;
  private readonly handleWheel = (event: WheelEvent): void => {
    if (event.ctrlKey || !this.view.hasFocus) {
      return;
    }
    if (!this.hasVerticalOverflow()) {
      return;
    }
    event.stopPropagation();
  };

  constructor(
    private readonly editorEl: HTMLDivElement,
    options: CodeBlockEditorOptions,
  ) {
    const escapeBindings: KeyBinding[] = [
      {
        key: 'ArrowUp',
        run: () => options.callbacks.onEscapeRequest('line', -1),
      },
      {
        key: 'ArrowDown',
        run: () => options.callbacks.onEscapeRequest('line', 1),
      },
      {
        key: 'ArrowLeft',
        run: () => options.callbacks.onEscapeRequest('char', -1),
      },
      {
        key: 'ArrowRight',
        run: () => options.callbacks.onEscapeRequest('char', 1),
      },
      {
        key: 'Mod-Enter',
        run: () => {
          options.callbacks.onExitCodeBlock();
          return true;
        },
      },
      {
        key: 'Shift-Enter',
        run: () => {
          options.callbacks.onExitCodeBlock();
          return true;
        },
      },
      {
        key: 'Mod-z',
        run: () => {
          options.callbacks.onUndo();
          return true;
        },
      },
      {
        key: 'Mod-Shift-z',
        run: () => {
          options.callbacks.onRedo();
          return true;
        },
      },
      {
        key: 'Mod-y',
        run: () => {
          options.callbacks.onRedo();
          return true;
        },
      },
    ];

    const extensions: Extension[] = [
      lineNumbers(),
      codeBlockLanguage(),
      syntaxHighlighting(codeBlockHighlightStyle),
      codeBlockEditorTheme,
      delimiterField,
      externalSelectionField,
      EditorView.updateListener.of((update: ViewUpdate) => {
        if (update.docChanged) {
          options.callbacks.onContentChange();
        }
        if (update.selectionSet) {
          options.callbacks.onSelectionChange();
        }
        if (update.heightChanged) {
          options.callbacks.onContentSizeChange();
        }
      }),
      Prec.highest(
        EditorView.domEventHandlers({
          keydown: (event) => {
            options.callbacks.onBoundaryInput({
              altKey: event.altKey,
              ctrlKey: event.ctrlKey,
              isComposing: event.isComposing,
              key: event.key,
              metaKey: event.metaKey,
              preventDefault: () => event.preventDefault(),
              stopPropagation: () => event.stopPropagation(),
            });
            return event.defaultPrevented;
          },
        }),
      ),
      Prec.highest(keymap.of(escapeBindings)),
      keymap.of([...defaultKeymap, indentWithTab]),
    ];

    this.view = new EditorView({
      doc: options.initialValue,
      extensions,
      parent: this.editorEl,
    });
    this.editorEl.addEventListener('wheel', this.handleWheel);
  }

  getValue(): string {
    return this.view.state.doc.toString();
  }

  setValue(value: string): void {
    if (value === this.getValue()) {
      return;
    }
    this.view.dispatch({
      changes: { from: 0, insert: value, to: this.view.state.doc.length },
    });
  }

  getSelection(): CodeBlockEditorSelection {
    const range = this.view.state.selection.main;
    return { empty: range.empty, from: range.from, to: range.to };
  }

  setSelection(anchor: number, head: number): void {
    const length = this.view.state.doc.length;
    this.view.focus();
    this.view.dispatch({
      scrollIntoView: true,
      selection: EditorSelection.range(
        clamp(anchor, 0, length),
        clamp(head, 0, length),
      ),
    });
  }

  clearSelection(): void {
    this.view.dispatch({ effects: setExternalSelectionEffect.of(null) });

    const range = this.view.state.selection.main;
    if (range.empty) {
      return;
    }
    this.view.dispatch({ selection: EditorSelection.cursor(range.head) });
  }

  focus(): void {
    this.view.focus();
  }

  hasTextFocus(): boolean {
    return this.view.hasFocus;
  }

  setDelimiterLines(lineNumbers: readonly number[]): void {
    this.view.dispatch({ effects: setDelimiterLines.of(lineNumbers) });
  }

  setExternalSelection(selection: CodeBlockExternalSelection | null): void {
    this.view.dispatch({ effects: setExternalSelectionEffect.of(selection) });
  }

  getCursorPosition(): CodeBlockEditorCursorPosition {
    const head = this.view.state.selection.main.head;
    const line = this.view.state.doc.lineAt(head);
    return { column: head - line.from + 1, lineNumber: line.number };
  }

  getLineMaxColumn(lineNumber: number): number | null {
    if (lineNumber < 1 || lineNumber > this.view.state.doc.lines) {
      return null;
    }
    return this.view.state.doc.line(lineNumber).length + 1;
  }

  getOffsetAtClientPoint(left: number, top: number): number | null {
    return this.view.posAtCoords({ x: left, y: top });
  }

  isCursorAtBoundary(
    unit: CodeBlockEditorEscapeUnit,
    dir: CodeBlockEditorDirection,
  ): boolean {
    const range = this.view.state.selection.main;
    if (!range.empty) {
      return false;
    }

    if (unit === 'line') {
      const lineNumber = this.view.state.doc.lineAt(range.head).number;
      const edgeLine = dir < 0 ? 1 : this.view.state.doc.lines;
      return lineNumber === edgeLine;
    }

    return dir < 0
      ? range.head === 0
      : range.head === this.view.state.doc.length;
  }

  syncLayout(
    options: CodeBlockEditorLayoutOptions = {},
  ): CodeBlockEditorLayout {
    // The editor auto-sizes to its content via CSS (min-height floor +
    // max-height cap, scrolling past the cap). We then read offsetHeight — the
    // rendered CSS-px height, which (unlike CodeMirror's contentHeight) is
    // immune to the canvas's ancestor `zoom`/`transform: scale` and matches the
    // coordinate space pagination measures blocks in.
    const cap =
      options.maxOuterHeightPx === undefined
        ? null
        : Math.max(MIN_OUTER_HEIGHT_PX, Math.floor(options.maxOuterHeightPx));
    this.view.dom.style.minHeight = `${MIN_OUTER_HEIGHT_PX}px`;
    this.view.dom.style.maxHeight = cap === null ? '' : `${cap}px`;

    const measured = this.view.dom.offsetHeight;
    const height = measured > 0 ? measured : MIN_OUTER_HEIGHT_PX;
    return { outerHeightPx: height };
  }

  dispose(): void {
    this.editorEl.removeEventListener('wheel', this.handleWheel);
    this.view.destroy();
  }

  private hasVerticalOverflow(): boolean {
    const scroller = this.view.scrollDOM;
    return scroller.scrollHeight > scroller.clientHeight + 1;
  }
}
