export const TREE_BASE_PADDING = 8;
// A folder's leading chevron (14px) plus its gap (6px), so a child's icon lines up directly under
// its parent's rather than a further step to the right.
export const TREE_DEPTH_INDENT = 20;
// Half the 14px chevron column, so a guide line runs through each level's
// chevron.
const TREE_GUIDE_OFFSET = 7;

/** Left padding for a row at the given depth (px). */
export function treeRowPadding(depth: number): number {
  return TREE_BASE_PADDING + depth * TREE_DEPTH_INDENT;
}

// A row at depth `d` draws `d` lines, each under an ancestor level's chevron. The host row must be
// positioned (`relative`).
export function TreeIndentGuides({ depth }: { depth: number }) {
  if (depth <= 0) {
    return null;
  }
  return (
    <>
      {Array.from({ length: depth }, (_, level) => (
        <span
          key={level}
          aria-hidden
          className="pointer-events-none absolute inset-y-0 w-px bg-border-subtle"
          style={{ left: treeRowPadding(level) + TREE_GUIDE_OFFSET }}
        />
      ))}
    </>
  );
}
