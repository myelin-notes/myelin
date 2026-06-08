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

/**
 * Reorder a count-sorted tag list so each parent is immediately followed by its
 * descendant subtree. Sibling groups (and roots) keep count-descending order
 * with an alphabetical tie-break. A list with no "/" tags is returned in the
 * same order it came in, so flat repositories are unaffected. Tags whose parent
 * is missing from the list are treated as roots rather than dropped.
 */
export function orderTagsHierarchically<
  T extends { tag: string; count: number },
>(tags: readonly T[]): T[] {
  const byTag = new Map(tags.map((entry) => [entry.tag, entry]));
  const children = new Map<string, T[]>();
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

  const result: T[] = [];
  const visit = (path: string) => {
    const group = children.get(path);
    if (!group) {
      return;
    }
    group.sort((a, b) =>
      b.count !== a.count ? b.count - a.count : a.tag.localeCompare(b.tag),
    );
    for (const entry of group) {
      result.push(entry);
      visit(entry.tag);
    }
  };
  visit('');
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
