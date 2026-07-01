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

export interface OrderedTag {
  tag: string;
  count: number;
  /** Nesting level: 0 for roots, +1 per present ancestor. */
  depth: number;
  /** The tag relative to its present parent — the leaf segment when nested. */
  label: string;
}

/**
 * Reorder a count-sorted tag list so each parent is immediately followed by its
 * descendant subtree, annotating every entry with its `depth` and a relative
 * `label` for indented rendering. Sibling groups (and roots) keep
 * count-descending order with an alphabetical tie-break. A list with no "/" tags
 * is returned in the same order it came in, so flat repositories are
 * unaffected. Tags whose parent is missing from the list are treated as roots
 * rather than dropped (and keep their full path as the label).
 */
export function orderTagsHierarchically(
  tags: readonly { tag: string; count: number }[],
): OrderedTag[] {
  const byTag = new Map(tags.map((entry) => [entry.tag, entry]));
  const children = new Map<string, { tag: string; count: number }[]>();
  for (const entry of tags) {
    const slash = entry.tag.lastIndexOf('/');
    const parent = slash === -1 ? '' : entry.tag.slice(0, slash);
    const key = parent !== '' && byTag.has(parent) ? parent : '';
    const group = children.get(key);
    if (group) {
      group.push(entry);
    } else {
      children.set(key, [entry]);
    }
  }

  const result: OrderedTag[] = [];
  const visit = (path: string, depth: number) => {
    const group = children.get(path);
    if (!group) {
      return;
    }
    group.sort((a, b) =>
      b.count !== a.count ? b.count - a.count : a.tag.localeCompare(b.tag),
    );
    for (const entry of group) {
      const label =
        depth === 0
          ? entry.tag
          : entry.tag.slice(entry.tag.lastIndexOf('/') + 1);
      result.push({ tag: entry.tag, count: entry.count, depth, label });
      visit(entry.tag, depth + 1);
    }
  };
  visit('', 0);
  return result;
}

export function normalizeTagInput(raw: string): string {
  return raw
    .trim()
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .join('/');
}
