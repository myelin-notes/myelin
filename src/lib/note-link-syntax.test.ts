import { describe, expect, it } from 'vitest';
import {
  escapeNoteLinkPath,
  escapeNoteLinkSegment,
  joinNoteLinkTitle,
  splitNoteLinkTargetFrame,
  splitNoteLinkTitle,
  unescapeNoteLinkSegment,
} from './note-link-syntax';

describe('escapeNoteLinkSegment', () => {
  it('escapes special characters', () => {
    expect(escapeNoteLinkSegment('Foo#Bar|Baz\\Qux')).toBe(
      'Foo\\#Bar\\|Baz\\\\Qux',
    );
  });

  it('leaves non-special characters alone', () => {
    expect(escapeNoteLinkSegment('Plain Note 123')).toBe('Plain Note 123');
  });

  it('returns empty for empty input', () => {
    expect(escapeNoteLinkSegment('')).toBe('');
  });

  it('escapes consecutive backslashes one-for-one', () => {
    expect(escapeNoteLinkSegment('\\')).toBe('\\\\');
    expect(escapeNoteLinkSegment('\\\\')).toBe('\\\\\\\\');
  });

  it('escapes a string of only special characters', () => {
    expect(escapeNoteLinkSegment('#|\\')).toBe('\\#\\|\\\\');
  });
});

describe('unescapeNoteLinkSegment', () => {
  it('reverses escape pairs', () => {
    expect(unescapeNoteLinkSegment('Foo\\#Bar\\|Baz\\\\Qux')).toBe(
      'Foo#Bar|Baz\\Qux',
    );
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
    'Section #3 | Plan B \\drafts',
    '#|\\',
    '\\\\',
    '\\#\\|\\\\',
    'plain',
    '',
  ])('round-trips %j through escape then unescape', (original) => {
    expect(unescapeNoteLinkSegment(escapeNoteLinkSegment(original))).toBe(
      original,
    );
  });
});

describe('splitNoteLinkTitle', () => {
  it('returns whole title when no alias', () => {
    expect(splitNoteLinkTitle('Note#Frame')).toEqual({
      target: 'Note#Frame',
      alias: null,
    });
  });

  it('splits on first unescaped pipe', () => {
    expect(splitNoteLinkTitle('Note#Frame|Display')).toEqual({
      target: 'Note#Frame',
      alias: 'Display',
    });
  });

  it('honors escaped pipe in target', () => {
    expect(splitNoteLinkTitle('A\\|B|Display')).toEqual({
      target: 'A\\|B',
      alias: 'Display',
    });
  });

  it('treats subsequent pipes as part of alias', () => {
    expect(splitNoteLinkTitle('Note|A|B')).toEqual({
      target: 'Note',
      alias: 'A|B',
    });
  });

  it('splits on a real pipe after a double-backslash', () => {
    // `\\` is an escaped backslash; the following `|` is a real delimiter.
    expect(splitNoteLinkTitle('A\\\\|B')).toEqual({
      target: 'A\\\\',
      alias: 'B',
    });
  });

  it('does not split when triple-backslash escapes the pipe', () => {
    // `\\` then `\|` → escaped backslash + escaped pipe; no delimiter.
    expect(splitNoteLinkTitle('A\\\\\\|B')).toEqual({
      target: 'A\\\\\\|B',
      alias: null,
    });
  });

  it('returns empty alias when title ends with pipe', () => {
    expect(splitNoteLinkTitle('Note|')).toEqual({
      target: 'Note',
      alias: '',
    });
  });

  it('returns empty target when title starts with pipe', () => {
    expect(splitNoteLinkTitle('|Alias')).toEqual({
      target: '',
      alias: 'Alias',
    });
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
    expect(joinNoteLinkTitle('Note', null, null)).toBe('Note');
  });

  it('joins note and frame', () => {
    expect(joinNoteLinkTitle('Note', 'Frame', null)).toBe('Note#Frame');
  });

  it('joins note, frame, and alias', () => {
    expect(joinNoteLinkTitle('Note', 'Frame', 'Display')).toBe(
      'Note#Frame|Display',
    );
  });

  it('preserves empty alias and frame', () => {
    expect(joinNoteLinkTitle('Note', '', '')).toBe('Note#|');
  });
});

describe('escapeNoteLinkPath', () => {
  it('escapes per segment', () => {
    expect(escapeNoteLinkPath('Folder#1/Note|A')).toBe('Folder\\#1/Note\\|A');
  });

  it('does not escape the path separator itself', () => {
    expect(escapeNoteLinkPath('A/B/C')).toBe('A/B/C');
  });

  it('escapes backslashes per segment', () => {
    expect(escapeNoteLinkPath('A\\B/C\\D')).toBe('A\\\\B/C\\\\D');
  });

  it('handles a single segment', () => {
    expect(escapeNoteLinkPath('Note|A')).toBe('Note\\|A');
  });
});

describe('full title round-trip', () => {
  it('escape -> split -> unescape recovers a target with all special chars', () => {
    const noteName = 'Plan #2 | draft \\v1';
    const frameName = 'Section #3';
    const aliasName = 'Display | label';
    const title = joinNoteLinkTitle(
      escapeNoteLinkSegment(noteName),
      escapeNoteLinkSegment(frameName),
      escapeNoteLinkSegment(aliasName),
    );

    const { target, alias } = splitNoteLinkTitle(title);
    const { noteTarget, frame } = splitNoteLinkTargetFrame(target);

    expect(unescapeNoteLinkSegment(noteTarget)).toBe(noteName);
    expect(frame).not.toBeNull();
    expect(unescapeNoteLinkSegment(frame ?? '')).toBe(frameName);
    expect(alias).not.toBeNull();
    expect(unescapeNoteLinkSegment(alias ?? '')).toBe(aliasName);
  });

  it('escape -> split keeps frame separator after escaped backslash', () => {
    // Note name is literally `A\` (ends with backslash); frame is `Frame`.
    const title = joinNoteLinkTitle(
      escapeNoteLinkSegment('A\\'),
      escapeNoteLinkSegment('Frame'),
      null,
    );
    expect(title).toBe('A\\\\#Frame');

    const { target } = splitNoteLinkTitle(title);
    const { noteTarget, frame } = splitNoteLinkTargetFrame(target);

    expect(unescapeNoteLinkSegment(noteTarget)).toBe('A\\');
    expect(frame).toBe('Frame');
  });
});
