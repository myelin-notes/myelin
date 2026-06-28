export function tagMatchesQuery(stored: string, query: string): boolean {
  return stored === query || stored.startsWith(`${query}/`);
}

export function nodeMatchesAnyTag(
  nodeTags: readonly string[],
  queryTags: readonly string[],
): boolean {
  return queryTags.some((query) =>
    nodeTags.some((tag) => tagMatchesQuery(tag, query)),
  );
}

export function expandTagWithAncestors(tag: string): string[] {
  const segments = tag.split('/');
  const result: string[] = [];
  let prefix = '';
  for (const segment of segments) {
    prefix = prefix === '' ? segment : `${prefix}/${segment}`;
    result.push(prefix);
  }
  return result;
}

export interface TagTreeNode {
  /** Full tag path, e.g. "uni/math". */
  tag: string;
  /** Trailing path segment, e.g. "math". */
  label: string;
  count: number;
  children: TagTreeNode[];
}

/**
 * Turn a flat tag list into a hierarchy keyed by the "/" separator. A tag whose
 * parent is absent from the list becomes a root rather than being dropped, so
 * callers that want intermediate parents must include them in the input. Roots
 * and sibling groups are count-descending with an alphabetical tie-break.
 */
export function buildTagTree(
  tags: readonly { tag: string; count: number }[],
): TagTreeNode[] {
  const byTag = new Map<string, TagTreeNode>();
  for (const { tag, count } of tags) {
    const slash = tag.lastIndexOf('/');
    byTag.set(tag, {
      tag,
      label: slash === -1 ? tag : tag.slice(slash + 1),
      count,
      children: [],
    });
  }

  const roots: TagTreeNode[] = [];
  for (const node of byTag.values()) {
    const slash = node.tag.lastIndexOf('/');
    const parent =
      slash === -1 ? undefined : byTag.get(node.tag.slice(0, slash));
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortNodes = (nodes: TagTreeNode[]) => {
    nodes.sort((a, b) =>
      b.count !== a.count ? b.count - a.count : a.tag.localeCompare(b.tag),
    );
    for (const node of nodes) {
      sortNodes(node.children);
    }
  };
  sortNodes(roots);
  return roots;
}

/** Index every node of a tag tree by its full tag for O(1) lookup. */
export function indexTagTree(
  nodes: readonly TagTreeNode[],
): Map<string, TagTreeNode> {
  const byTag = new Map<string, TagTreeNode>();
  const visit = (node: TagTreeNode) => {
    byTag.set(node.tag, node);
    for (const child of node.children) {
      visit(child);
    }
  };
  for (const node of nodes) {
    visit(node);
  }
  return byTag;
}

function removeSubtree(set: Set<string>, node: TagTreeNode | undefined): void {
  if (!node) {
    return;
  }
  for (const child of node.children) {
    set.delete(child.tag);
    removeSubtree(set, child);
  }
}

/**
 * Toggle a tag in a tri-state tree selection and return the next compact set.
 *
 * The set stays minimal: a selected tag implicitly covers its whole subtree (the
 * filter matches descendants by inheritance), so a node is never stored
 * alongside a selected ancestor or descendant. Selecting a node adds it and
 * drops any now-redundant descendants. Deselecting a node that is only covered
 * by a selected ancestor pushes that ancestor's coverage down to its other
 * branches, leaving the ancestor partially selected.
 */
export function toggleTagSelection(
  activeTags: ReadonlySet<string>,
  tag: string,
  byTag: ReadonlyMap<string, TagTreeNode>,
): Set<string> {
  const next = new Set(activeTags);
  // Root-first chain of ancestors ending with the tag itself.
  const path = expandTagWithAncestors(tag);
  const selectedIndex = path.findIndex((entry) => next.has(entry));

  if (selectedIndex === -1) {
    // Neither the tag nor an ancestor is selected → select the whole subtree.
    next.add(tag);
    removeSubtree(next, byTag.get(tag));
    return next;
  }

  // The tag is covered by itself or an ancestor. Drop that coverage, then walk
  // back down toward the tag re-selecting every sibling branch along the way so
  // only the tag's own subtree ends up deselected.
  next.delete(path[selectedIndex]);
  for (let depth = selectedIndex; depth < path.length - 1; depth++) {
    const parent = byTag.get(path[depth]);
    if (!parent) {
      continue;
    }
    for (const child of parent.children) {
      if (child.tag !== path[depth + 1]) {
        next.add(child.tag);
      }
    }
  }
  removeSubtree(next, byTag.get(tag));
  return next;
}

export function normalizeTagInput(raw: string): string {
  return raw
    .trim()
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .join('/');
}
