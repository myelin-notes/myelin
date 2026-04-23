import type { CodeBlockEditorExternalSelection } from './code-block-editor-adapter';

export const CODE_BLOCK_EXTERNAL_SELECTION_EVENT =
  'myelin:code-block-external-selection';

export type CodeBlockExternalSelectionDetail =
  CodeBlockEditorExternalSelection | null;

export function getCodeBlockExternalSelection(
  selectionFrom: number,
  selectionTo: number,
  contentStart: number,
  contentEnd: number,
): CodeBlockExternalSelectionDetail {
  if (
    selectionFrom === selectionTo ||
    selectionTo <= contentStart ||
    selectionFrom >= contentEnd
  ) {
    return null;
  }

  return {
    from: Math.max(selectionFrom, contentStart) - contentStart,
    to: Math.min(selectionTo, contentEnd) - contentStart,
  };
}
