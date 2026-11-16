import type { Mark, MarkType } from 'prosemirror-model';
import type { EditorState } from 'prosemirror-state';

export function selectionHasMark(
  state: EditorState,
  markType: MarkType,
  matches: (mark: Mark) => boolean = () => true,
): boolean {
  const { $from, empty } = state.selection;
  if (empty) {
    const mark = markType.isInSet(state.storedMarks ?? $from.marks());
    return !!mark && matches(mark);
  }

  return selectionSomeText(state, (marks) => {
    const mark = markType.isInSet(marks);
    return !!mark && matches(mark);
  });
}

export function selectionSomeText(
  state: EditorState,
  matches: (marks: readonly Mark[]) => boolean,
): boolean {
  let found = false;
  for (const { $from, $to } of state.selection.ranges) {
    state.doc.nodesBetween($from.pos, $to.pos, (node) => {
      if (!node.isText || found) {
        return;
      }
      found = matches(node.marks);
    });
  }
  return found;
}

export function uniformSelectionMarkAttrs(
  state: EditorState,
  markType: MarkType,
): Record<string, unknown> | null {
  const { empty, $from, ranges } = state.selection;
  if (empty) {
    const mark = markType.isInSet(state.storedMarks ?? $from.marks());
    return mark ? (mark.attrs as Record<string, unknown>) : null;
  }

  let result: Record<string, unknown> | null = null;
  let consistent = true;
  for (const range of ranges) {
    state.doc.nodesBetween(range.$from.pos, range.$to.pos, (node) => {
      if (!node.isText) {
        return;
      }
      const mark = markType.isInSet(node.marks);
      if (!mark) {
        consistent = false;
        return;
      }
      if (result && JSON.stringify(result) !== JSON.stringify(mark.attrs)) {
        consistent = false;
        return;
      }
      result = mark.attrs as Record<string, unknown>;
    });
  }
  return consistent ? result : null;
}
