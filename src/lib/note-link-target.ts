export interface ParsedNoteLinkTarget {
  noteTarget: string;
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
  const noteTarget = rawNoteTarget.trim();
  if (!noteTarget) {
    return null;
  }

  const pageFrameName = rawPageFrameName?.trim() || null;
  return { noteTarget, pageFrameName };
}
