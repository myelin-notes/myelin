import { describe, expect, it } from 'vitest';
import {
  escapeNoteLinkPath,
  escapeNoteLinkSegment,
  joinNoteLinkTitle,
  splitNoteLinkTargetFrame,
  unescapeNoteLinkSegment,
} from './note-link-syntax';

describe('escapeNoteLinkSegment', () => {
  it('escapes special characters', () => {
    expect(escapeNoteLinkSegment('Foo#Bar\\Qux')).toBe('Foo\\#Bar\\\\Qux');
  });

  it('leaves non-special characters alone', () => {
    expect(escapeNoteLinkSegment('Plain Note 123')).toBe('Plain Note 123');
  });

  it('leaves pipe alone', () => {
    expect(escapeNoteLinkSegment('Foo|Bar')).toBe('Foo|Bar');
  });

  it('returns empty for empty input', () => {
    expect(escapeNoteLinkSegment('')).toBe('');
  });

  it('escapes consecutive backslashes one-for-one', () => {
    expect(escapeNoteLinkSegment('\\')).toBe('\\\\');
    expect(escapeNoteLinkSegment('\\\\')).toBe('\\\\\\\\');
  });

  it('escapes a string of only special characters', () => {
    expect(escapeNoteLinkSegment('#\\')).toBe('\\#\\\\');
  });
});

describe('unescapeNoteLinkSegment', () => {
  it('reverses escape pairs', () => {
    expect(unescapeNoteLinkSegment('Foo\\#Bar\\\\Qux')).toBe('Foo#Bar\\Qux');
  });

  it('treats unknown escapes as literal next char', () => {
    expect(unescapeNoteLinkSegment('Foo\\nBar')).toBe('FoonBar');
  });

  it('keeps a trailing lone backslash', () => {
    expect(unescapeNoteLinkSegment('Foo\\')).toBe('Foo\\');
  });

  it('processes consecutive escape pairs left to right', () => {
    expect(unescapeNoteLinkSegment('\\\\\\\\')).toBe('\\\\');
    expect(unescapeNoteLinkSegment('\\\\\\#')).toBe('\\#');
    expect(unescapeNoteLinkSegment('\\\\#')).toBe('\\#');
  });

  it('returns empty for empty input', () => {
    expect(unescapeNoteLinkSegment('')).toBe('');
  });

  it.each([
    'Section #3 \\drafts',
    '#\\',
    '\\\\',
    '\\#\\\\',
    'plain',
    'has | pipe',
    '',
  ])('round-trips %j through escape then unescape', (original) => {
    expect(unescapeNoteLinkSegment(escapeNoteLinkSegment(original))).toBe(
      original,
    );
  });
});

describe('splitNoteLinkTargetFrame', () => {
  it('returns whole target when no frame', () => {
    expect(splitNoteLinkTargetFrame('Note')).toEqual({
      noteTarget: 'Note',
      frame: null,
    });
  });

  it('splits on first unescaped hash', () => {
    expect(splitNoteLinkTargetFrame('Note#Frame')).toEqual({
      noteTarget: 'Note',
      frame: 'Frame',
    });
  });

  it('honors escaped hash in note target', () => {
    expect(splitNoteLinkTargetFrame('A\\#B#Frame')).toEqual({
      noteTarget: 'A\\#B',
      frame: 'Frame',
    });
  });

  it('splits on a real hash after a double-backslash', () => {
    expect(splitNoteLinkTargetFrame('A\\\\#Frame')).toEqual({
      noteTarget: 'A\\\\',
      frame: 'Frame',
    });
  });

  it('does not split when triple-backslash escapes the hash', () => {
    expect(splitNoteLinkTargetFrame('A\\\\\\#Frame')).toEqual({
      noteTarget: 'A\\\\\\#Frame',
      frame: null,
    });
  });

  it('treats subsequent hashes as part of the frame', () => {
    expect(splitNoteLinkTargetFrame('Note#Frame#extra')).toEqual({
      noteTarget: 'Note',
      frame: 'Frame#extra',
    });
  });

  it('returns empty frame when target ends with hash', () => {
    expect(splitNoteLinkTargetFrame('Note#')).toEqual({
      noteTarget: 'Note',
      frame: '',
    });
  });

  it('does not consume the next char when a lone trailing backslash precedes nothing', () => {
    // Trailing `\` with no follower is preserved as literal; no pseudo-escape.
    expect(splitNoteLinkTargetFrame('Note\\')).toEqual({
      noteTarget: 'Note\\',
      frame: null,
    });
  });
});

describe('joinNoteLinkTitle', () => {
  it('joins note only', () => {
    expect(joinNoteLinkTitle('Note', null)).toBe('Note');
  });

  it('joins note and frame', () => {
    expect(joinNoteLinkTitle('Note', 'Frame')).toBe('Note#Frame');
  });

  it('preserves empty frame', () => {
    expect(joinNoteLinkTitle('Note', '')).toBe('Note#');
  });
});

describe('escapeNoteLinkPath', () => {
  it('escapes per segment', () => {
    expect(escapeNoteLinkPath('Folder#1/Note')).toBe('Folder\\#1/Note');
  });

  it('does not escape the path separator itself', () => {
    expect(escapeNoteLinkPath('A/B/C')).toBe('A/B/C');
  });

  it('escapes backslashes per segment', () => {
    expect(escapeNoteLinkPath('A\\B/C\\D')).toBe('A\\\\B/C\\\\D');
  });

  it('leaves pipe alone', () => {
    expect(escapeNoteLinkPath('Note|A')).toBe('Note|A');
  });
});

describe('full title round-trip', () => {
  it('escape -> split -> unescape recovers a target with all special chars', () => {
    const noteName = 'Plan #2 \\v1';
    const frameName = 'Section #3';
    const title = joinNoteLinkTitle(
      escapeNoteLinkSegment(noteName),
      escapeNoteLinkSegment(frameName),
    );

    const { noteTarget, frame } = splitNoteLinkTargetFrame(title);

    expect(unescapeNoteLinkSegment(noteTarget)).toBe(noteName);
    expect(frame).not.toBeNull();
    expect(unescapeNoteLinkSegment(frame ?? '')).toBe(frameName);
  });

  it('escape -> split keeps frame separator after escaped backslash', () => {
    // Note name is literally `A\` (ends with backslash); frame is `Frame`.
    const title = joinNoteLinkTitle(
      escapeNoteLinkSegment('A\\'),
      escapeNoteLinkSegment('Frame'),
    );
    expect(title).toBe('A\\\\#Frame');

    const { noteTarget, frame } = splitNoteLinkTargetFrame(title);

    expect(unescapeNoteLinkSegment(noteTarget)).toBe('A\\');
    expect(frame).toBe('Frame');
  });
});
