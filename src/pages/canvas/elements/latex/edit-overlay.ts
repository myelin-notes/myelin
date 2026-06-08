import type {
  MathSourceEditor,
  MathSourceEditorOwner,
} from '../../page-frame/pm/math/source-editor';

interface LatexEditOverlayRect {
  left: number;
  top: number;
  width: number;
}

interface LatexEditOverlayOptions {
  initialLatex: string;
  rect: LatexEditOverlayRect;
  /** Fired on every keystroke with the current source. */
  onChange: (latex: string) => void;
  /** Fired when the editor asks to finish editing (Esc-like exits). */
  onCommit: () => void;
}

export interface LatexEditOverlayHandle {
  root: HTMLDivElement;
  focus: () => void;
  getValue: () => string;
  reposition: (rect: LatexEditOverlayRect) => void;
  dispose: () => void;
}

/**
 * Floating source editor for a canvas LaTeX block. Borrows the page frame's
 * shared CodeMirror math editor (one instance, re-parented per active block)
 * by implementing its owner interface — the canvas plays the role ProseMirror
 * plays for page frame math blocks. The block's local state is the source of
 * truth here, so owner callbacks just forward edits and exits; the
 * PM-history/fence behaviors the editor also offers have no canvas analogue
 * and are intentionally inert.
 */
export function createLatexEditOverlay(
  options: LatexEditOverlayOptions,
): LatexEditOverlayHandle {
  const root = document.createElement('div');
  root.className = 'canvas-latex-edit';
  applyRect(root, options.rect);

  const source = document.createElement('div');
  source.className = 'canvas-latex-source';
  root.appendChild(source);
  document.body.appendChild(root);

  let editor: MathSourceEditor | null = null;
  let disposed = false;
  let value = options.initialLatex;

  const owner: MathSourceEditorOwner = {
    onContentChange: () => {
      value = editor?.getValue() ?? value;
      options.onChange(value);
    },
    onSelectionChange: () => {},
    // Backspace in an empty editor finishes editing; the block, now empty,
    // removes itself on exit.
    onDeleteEmptyBlock: () => {
      options.onCommit();
      return true;
    },
    // Plain Enter inserts a newline (multi-line formulas); Mod/Shift-Enter
    // exits via onExitBlock below.
    onEnter: () => false,
    onSelectAll: () => false,
    // No surrounding document to escape into on the canvas.
    onEscapeRequest: () => false,
    onExitBlock: () => options.onCommit(),
    // The canvas has no nested editor history; let these no-op rather than
    // reach into the global canvas undo stack mid-edit.
    onUndo: () => {},
    onRedo: () => {},
  };

  void import('../../page-frame/pm/math/source-editor')
    .then((module) => module.getSharedMathSourceEditor())
    .then((shared) => {
      if (disposed) {
        return;
      }
      editor = shared;
      shared.attach(source, owner, value);
      shared.setSelection(value.length, value.length);
    });

  return {
    root,
    focus: () => editor?.focus(),
    getValue: () => editor?.getValue() ?? value,
    reposition: (rect) => applyRect(root, rect),
    dispose: () => {
      disposed = true;
      editor?.release(owner);
      editor = null;
      root.remove();
    },
  };
}

function applyRect(root: HTMLDivElement, rect: LatexEditOverlayRect): void {
  root.style.left = `${rect.left}px`;
  root.style.top = `${rect.top}px`;
  root.style.width = `${rect.width}px`;
}
