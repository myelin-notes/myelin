import { describe, expect, it } from 'vitest';
import { parseNoteLinkTarget } from './note-link-target';

describe('parseNoteLinkTarget', () => {
  it('parses a bare note name', () => {
    expect(parseNoteLinkTarget('Alpha')).toEqual({
      isPath: false,
      path: 'Alpha',
      noteName: 'Alpha',
      pageFrameName: null,
    });
  });

  it('parses note + frame', () => {
    expect(parseNoteLinkTarget('Alpha#Frame')).toEqual({
      isPath: false,
      path: 'Alpha',
      noteName: 'Alpha',
      pageFrameName: 'Frame',
    });
  });

  it('parses note + frame + alias and ignores the alias', () => {
    expect(parseNoteLinkTarget('Alpha#Frame|Display')).toEqual({
      isPath: false,
      path: 'Alpha',
      noteName: 'Alpha',
      pageFrameName: 'Frame',
    });
  });

  it('parses a slash-delimited path', () => {
    expect(parseNoteLinkTarget('Projects/Alpha')).toEqual({
      isPath: true,
      path: 'Projects/Alpha',
      noteName: 'Alpha',
      pageFrameName: null,
    });
  });

  it('returns null for empty or whitespace-only target', () => {
    expect(parseNoteLinkTarget('')).toBeNull();
    expect(parseNoteLinkTarget('   ')).toBeNull();
    expect(parseNoteLinkTarget('|alias')).toBeNull();
  });

  it('returns null when a path segment is empty', () => {
    expect(parseNoteLinkTarget('Projects//Alpha')).toBeNull();
    expect(parseNoteLinkTarget('/Alpha')).toBeNull();
    expect(parseNoteLinkTarget('Alpha/')).toBeNull();
  });

  it('unescapes hash in the note name', () => {
    expect(parseNoteLinkTarget('A\\#B')).toEqual({
      isPath: false,
      path: 'A#B',
      noteName: 'A#B',
      pageFrameName: null,
    });
  });

  it('unescapes pipe in the note name', () => {
    expect(parseNoteLinkTarget('A\\|B')).toEqual({
      isPath: false,
      path: 'A|B',
      noteName: 'A|B',
      pageFrameName: null,
    });
  });

  it('unescapes hash and pipe in the frame name', () => {
    expect(parseNoteLinkTarget('Alpha#Plan \\#2 \\| draft')).toEqual({
      isPath: false,
      path: 'Alpha',
      noteName: 'Alpha',
      pageFrameName: 'Plan #2 | draft',
    });
  });

  it('unescapes per path segment', () => {
    expect(parseNoteLinkTarget('Folder\\#1/Note\\|A')).toEqual({
      isPath: true,
      path: 'Folder#1/Note|A',
      noteName: 'Note|A',
      pageFrameName: null,
    });
  });

  it('treats double-backslash as escaped backslash, then real hash', () => {
    // `A\\#B` → note name `A\`, frame `B`
    expect(parseNoteLinkTarget('A\\\\#B')).toEqual({
      isPath: false,
      path: 'A\\',
      noteName: 'A\\',
      pageFrameName: 'B',
    });
  });

  it('treats triple-backslash as escaped backslash + escaped hash', () => {
    expect(parseNoteLinkTarget('A\\\\\\#B')).toEqual({
      isPath: false,
      path: 'A\\#B',
      noteName: 'A\\#B',
      pageFrameName: null,
    });
  });

  it('returns null pageFrameName when the frame is empty', () => {
    expect(parseNoteLinkTarget('Alpha#')).toEqual({
      isPath: false,
      path: 'Alpha',
      noteName: 'Alpha',
      pageFrameName: null,
    });
  });

  it('returns null pageFrameName when the frame is only whitespace', () => {
    expect(parseNoteLinkTarget('Alpha#   ')).toEqual({
      isPath: false,
      path: 'Alpha',
      noteName: 'Alpha',
      pageFrameName: null,
    });
  });

  it('preserves a hash in the alias as literal (not parsed as a frame)', () => {
    // Alias `Has#Hash` — the `#` is past the alias boundary, so target is
    // just `Note` and the frame stays null.
    expect(parseNoteLinkTarget('Note|Has#Hash')).toEqual({
      isPath: false,
      path: 'Note',
      noteName: 'Note',
      pageFrameName: null,
    });
  });
});
