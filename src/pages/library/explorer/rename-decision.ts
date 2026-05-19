import type { NoteBacklink } from '@/lib/sync';

export type RenameDecision =
  | { kind: 'plain' }
  | { kind: 'commit-with-refs' }
  | { kind: 'prompt'; mentionCount: number; noteCount: number };

export function evaluateRenameDecision(
  backlinks: readonly NoteBacklink[],
  alwaysRenameReferences: boolean,
): RenameDecision {
  if (backlinks.length === 0) {
    return { kind: 'plain' };
  }
  if (alwaysRenameReferences) {
    return { kind: 'commit-with-refs' };
  }
  const noteCount = new Set(backlinks.map((b) => b.sourceId)).size;
  return {
    kind: 'prompt',
    mentionCount: backlinks.length,
    noteCount,
  };
}
