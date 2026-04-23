import type { CodeBlockEditorExternalSelection } from './code-block-editor-adapter';

export const CODE_BLOCK_EXTERNAL_SELECTION_EVENT =
  'myelin:code-block-external-selection';

export type CodeBlockExternalSelectionDetail =
  CodeBlockEditorExternalSelection | null;
