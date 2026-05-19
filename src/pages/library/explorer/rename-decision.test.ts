import { describe, expect, it } from 'vitest';
import type { NoteBacklink, VFSNodeId } from '@/lib/sync';
import { evaluateRenameDecision } from './rename-decision';

function backlink(sourceId: string): NoteBacklink {
  return {
    sourceId: sourceId as VFSNodeId,
    sourceName: `note-${sourceId}`,
    targetId: 'target' as VFSNodeId,
    pageFrameId: null,
    title: 'old-name',
    snippet: '',
  };
}

describe('evaluateRenameDecision', () => {
  it('returns plain when there are no backlinks', () => {
    expect(evaluateRenameDecision([], false)).toEqual({ kind: 'plain' });
    expect(evaluateRenameDecision([], true)).toEqual({ kind: 'plain' });
  });

  it('commits-with-refs without prompting when the always-pref is set', () => {
    expect(evaluateRenameDecision([backlink('a')], true)).toEqual({
      kind: 'commit-with-refs',
    });
  });

  it('prompts when backlinks exist and the always-pref is unset', () => {
    expect(
      evaluateRenameDecision([backlink('a'), backlink('b')], false),
    ).toEqual({
      kind: 'prompt',
      mentionCount: 2,
      noteCount: 2,
    });
  });

  it('counts unique source notes when the same note has multiple mentions', () => {
    expect(
      evaluateRenameDecision(
        [backlink('a'), backlink('a'), backlink('b')],
        false,
      ),
    ).toEqual({
      kind: 'prompt',
      mentionCount: 3,
      noteCount: 2,
    });
  });
});
