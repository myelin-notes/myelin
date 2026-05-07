export interface ParsedNoteLinkTarget {
  isPath: boolean;
  path: string;
  noteName: string;
  pageFrameName: string | null;
}

export function parseNoteLinkTarget(
  target: string,
): ParsedNoteLinkTarget | null {
  const withoutAlias = target.split('|', 1)[0]?.trim() ?? '';
  if (!withoutAlias) {
    return null;
  }

  const [rawNoteTarget, rawPageFrameName] = withoutAlias.split('#', 2);
  const segments = rawNoteTarget.split('/').map((segment) => segment.trim());
  if (segments.some((segment) => segment.length === 0)) {
    return null;
  }

  const noteName = segments[segments.length - 1];
  return {
    isPath: segments.length > 1,
    path: segments.join('/'),
    noteName,
    pageFrameName: rawPageFrameName?.trim() || null,
  };
}
