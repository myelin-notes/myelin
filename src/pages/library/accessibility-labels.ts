function formatTagName(tag: string): string {
  return `#${tag}`;
}

export function formatSemanticTagAccessibleName(
  tag: string,
  count: number,
  formattedCount: string,
): string {
  return `${formatTagName(tag)}, ${formattedCount} ${
    count === 1 ? 'item' : 'items'
  }`;
}

export function formatExplorerItemAccessibleName(
  name: string,
  tags: string[],
): string {
  if (tags.length === 0) {
    return name;
  }

  const visibleTags = tags
    .slice(0, 2)
    .map((tag) => formatTagName(tag))
    .join(', ');
  const overflowCount = tags.length - 2;
  const overflow =
    overflowCount > 0
      ? `, ${overflowCount} more ${overflowCount === 1 ? 'tag' : 'tags'}`
      : '';

  return `${name}, tags: ${visibleTags}${overflow}`;
}
