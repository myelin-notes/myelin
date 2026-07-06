import { EditorSelection, type Extension } from '@codemirror/state';
import { EditorView, type KeyBinding } from '@codemirror/view';

export type NestedEditorDirection = -1 | 1;

export type NestedEditorEscapeUnit = 'char' | 'line';

export interface NestedEditorSelection {
  empty: boolean;
  from: number;
  to: number;
}

/** Key behavior every nested editor forwards to its node view. */
export interface NestedEditorKeyCallbacks {
  onEscapeRequest: (
    unit: NestedEditorEscapeUnit,
    dir: NestedEditorDirection,
  ) => boolean;
  onExitBlock: () => void;
  onRedo: () => void;
  onUndo: () => void;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Arrow-at-boundary escape, Mod/Shift-Enter block exit, and ProseMirror
 * history forwarding — the bindings every nested editor needs. Callbacks
 * resolve through a thunk so editors with a swappable owner (the shared math
 * source editor) can reuse them; with no owner the binding falls through to
 * CodeMirror's defaults.
 */
export function nestedEditorKeyBindings(
  getCallbacks: () => NestedEditorKeyCallbacks | null,
): KeyBinding[] {
  const bind = (
    key: string,
    run: (callbacks: NestedEditorKeyCallbacks) => boolean,
  ): KeyBinding => ({
    key,
    run: () => {
      const callbacks = getCallbacks();
      return callbacks ? run(callbacks) : false;
    },
  });

  return [
    bind('ArrowUp', (cb) => cb.onEscapeRequest('line', -1)),
    bind('ArrowDown', (cb) => cb.onEscapeRequest('line', 1)),
    bind('ArrowLeft', (cb) => cb.onEscapeRequest('char', -1)),
    bind('ArrowRight', (cb) => cb.onEscapeRequest('char', 1)),
    bind('Mod-Enter', (cb) => {
      cb.onExitBlock();
      return true;
    }),
    bind('Shift-Enter', (cb) => {
      cb.onExitBlock();
      return true;
    }),
    bind('Mod-z', (cb) => {
      cb.onUndo();
      return true;
    }),
    bind('Mod-Shift-z', (cb) => {
      cb.onRedo();
      return true;
    }),
    bind('Mod-y', (cb) => {
      cb.onRedo();
      return true;
    }),
  ];
}

interface NestedEditorConfig {
  doc?: string;
  extensions: Extension;
  parent?: Element;
}

/**
 * Common wrapper around a CodeMirror EditorView nested inside a ProseMirror
 * node view (code blocks, math source). Owns the document/selection/focus
 * API the node views forward through, plus the wheel guard; subclasses
 * supply extensions and decide where the view mounts.
 */
export abstract class NestedEditor {
  protected readonly view: EditorView;

  // Without this the canvas pan handler swallows wheel events, so a
  // scrollable editor could never scroll. Only consume the event while the
  // editor is focused, and never for ctrl-wheel (pinch zoom). Subclasses
  // attach it to their host element.
  protected readonly handleWheel = (event: WheelEvent): void => {
    if (event.ctrlKey || !this.view.hasFocus) {
      return;
    }
    const scroller = this.view.scrollDOM;
    if (scroller.scrollHeight > scroller.clientHeight + 1) {
      event.stopPropagation();
    }
  };

  protected constructor(config: NestedEditorConfig) {
    this.view = new EditorView(config);
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

  getSelection(): NestedEditorSelection {
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

  focus(): void {
    this.view.focus();
  }

  hasTextFocus(): boolean {
    return this.view.hasFocus;
  }

  isCursorAtBoundary(
    unit: NestedEditorEscapeUnit,
    dir: NestedEditorDirection,
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
}
