export type CodeBlockEditorDirection = -1 | 1;

export type CodeBlockEditorEscapeUnit = 'char' | 'line';

export interface CodeBlockEditorSelection {
  empty: boolean;
  from: number;
  to: number;
}

export interface CodeBlockEditorExternalSelection {
  from: number;
  to: number;
}

export interface CodeBlockEditorCursorPosition {
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

export interface CodeBlockEditorLayout {
  outerHeightPx: number;
}

export interface CodeBlockEditorCallbacks {
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

export interface CodeBlockEditorAdapter {
  dispose: () => void;
  focus: () => void;
  getCursorPosition: () => CodeBlockEditorCursorPosition | null;
  getLineMaxColumn: (lineNumber: number) => number | null;
  getOffsetAtClientPoint: (left: number, top: number) => number | null;
  getSelection: () => CodeBlockEditorSelection | null;
  getValue: () => string;
  hasTextFocus: () => boolean;
  isCursorAtBoundary: (
    unit: CodeBlockEditorEscapeUnit,
    dir: CodeBlockEditorDirection,
  ) => boolean;
  setDelimiterLines: (lineNumbers: readonly number[]) => void;
  setExternalSelection: (
    selection: CodeBlockEditorExternalSelection | null,
  ) => void;
  setLanguage: (language: string | null) => void;
  setSelection: (anchor: number, head: number) => void;
  setValue: (value: string) => void;
  syncLayout: () => CodeBlockEditorLayout;
}
