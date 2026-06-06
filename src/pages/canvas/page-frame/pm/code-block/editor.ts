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
  keymap,
  lineNumbers,
  type ViewUpdate,
} from '@codemirror/view';
import {
  clamp,
  NestedEditor,
  type NestedEditorKeyCallbacks,
  nestedEditorKeyBindings,
} from '../nested-editor/editor';
import type { CodeBlockExternalSelection } from './selection-sync';
import {
  codeBlockEditorTheme,
  codeBlockHighlightStyle,
  codeBlockLanguage,
} from './theme';

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

interface CodeBlockEditorCallbacks extends NestedEditorKeyCallbacks {
  onBoundaryInput: (event: CodeBlockEditorBoundaryInput) => void;
  onContentChange: () => void;
  onContentSizeChange: () => void;
  onSelectionChange: () => void;
}

interface CodeBlockEditorOptions {
  callbacks: CodeBlockEditorCallbacks;
  initialValue: string;
}

const MIN_OUTER_HEIGHT_PX = 72;

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

export class CodeBlockEditor extends NestedEditor {
  constructor(
    private readonly editorEl: HTMLDivElement,
    options: CodeBlockEditorOptions,
  ) {
    const extensions: Extension[] = [
      // Page-height cap comes from the shared .pm-page-capped CSS rule; the
      // .cm-scroller (overflow: auto) scrolls past it. Applied via
      // editorAttributes because CodeMirror owns view.dom's class attribute
      // and wipes externally added classes on update.
      EditorView.editorAttributes.of({ class: 'pm-page-capped' }),
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
      Prec.highest(keymap.of(nestedEditorKeyBindings(() => options.callbacks))),
      keymap.of([...defaultKeymap, indentWithTab]),
    ];

    super({ doc: options.initialValue, extensions, parent: editorEl });
    this.editorEl.addEventListener('wheel', this.handleWheel);
  }

  clearSelection(): void {
    this.view.dispatch({ effects: setExternalSelectionEffect.of(null) });

    const range = this.view.state.selection.main;
    if (range.empty) {
      return;
    }
    this.view.dispatch({ selection: EditorSelection.cursor(range.head) });
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

  syncLayout(): CodeBlockEditorLayout {
    // The editor auto-sizes to its content via CSS (min-height floor + the
    // .pm-page-capped max-height, scrolling past the cap). We then read
    // offsetHeight — the rendered CSS-px height, which (unlike CodeMirror's
    // contentHeight) is immune to the canvas's ancestor `zoom`/`transform:
    // scale` and matches the coordinate space pagination measures blocks in.
    this.view.dom.style.minHeight = `${MIN_OUTER_HEIGHT_PX}px`;

    const measured = this.view.dom.offsetHeight;
    const height = measured > 0 ? measured : MIN_OUTER_HEIGHT_PX;
    return { outerHeightPx: height };
  }

  dispose(): void {
    this.editorEl.removeEventListener('wheel', this.handleWheel);
    this.view.destroy();
  }
}
