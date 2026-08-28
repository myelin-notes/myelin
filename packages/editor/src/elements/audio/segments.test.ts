import { describe, expect, it } from 'vitest';
import { activeSegmentIndex, segmentsToText, toSegments } from './segments';

describe('toSegments', () => {
  it('trims text and drops malformed or empty entries', () => {
    const segments = toSegments([
      { startSeconds: 0, endSeconds: 1.5, text: '  hello  ' },
      { startSeconds: 1.5, endSeconds: 2, text: '   ' },
      { startSeconds: 2, endSeconds: 3 },
      { startSeconds: '3', endSeconds: 4, text: 'world' },
      'not a segment',
      null,
    ]);

    expect(segments).toEqual([
      { startSeconds: 0, endSeconds: 1.5, text: 'hello' },
    ]);
  });

  it('returns nothing for a value that is not an array', () => {
    expect(toSegments(undefined)).toEqual([]);
    expect(toSegments('hello world')).toEqual([]);
  });
});

describe('segmentsToText', () => {
  it('joins segment text with single spaces', () => {
    expect(
      segmentsToText([
        { startSeconds: 0, endSeconds: 1, text: 'hello' },
        { startSeconds: 1, endSeconds: 2, text: 'world' },
      ]),
    ).toBe('hello world');
  });
});

describe('activeSegmentIndex', () => {
  const segments = [
    { startSeconds: 0, endSeconds: 1.5, text: 'first' },
    { startSeconds: 2, endSeconds: 3, text: 'second' },
  ];

  it('finds the segment covering the playhead', () => {
    expect(activeSegmentIndex(segments, 0)).toBe(0);
    expect(activeSegmentIndex(segments, 1.4)).toBe(0);
    expect(activeSegmentIndex(segments, 2.9)).toBe(1);
  });

  it('reports nothing in the silence between segments, or past the end', () => {
    expect(activeSegmentIndex(segments, 1.7)).toBe(-1);
    expect(activeSegmentIndex(segments, 9)).toBe(-1);
  });

  it('reports nothing without segments', () => {
    expect(activeSegmentIndex([], 0)).toBe(-1);
  });
});
