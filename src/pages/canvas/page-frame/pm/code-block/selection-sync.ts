export interface CodeBlockExternalSelection {
  from: number;
  to: number;
}

export type CodeBlockExternalSelectionDetail =
  CodeBlockExternalSelection | null;

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
