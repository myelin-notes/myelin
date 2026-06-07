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

export function normalizeTagInput(raw: string): string {
  return raw
    .trim()
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .join('/');
}
