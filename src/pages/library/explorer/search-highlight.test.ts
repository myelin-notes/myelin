import { describe, expect, it } from 'vitest';
import { findMatchRanges } from './search-highlight';

describe('findMatchRanges', () => {
  it('returns no ranges when there are no terms', () => {
    expect(findMatchRanges('hello world', [])).toEqual([]);
  });

  it('returns no ranges when nothing matches', () => {
    expect(findMatchRanges('hello world', ['xyz'])).toEqual([]);
  });

  it('finds every occurrence of a term', () => {
    expect(findMatchRanges('a cat and a cat', ['cat'])).toEqual([
      [2, 5],
      [12, 15],
    ]);
  });

  it('matches case-insensitively', () => {
    expect(findMatchRanges('Category CATalog', ['cat'])).toEqual([
      [0, 3],
      [9, 12],
    ]);
  });

  it('merges overlapping ranges from different terms', () => {
    // "cat" (0-3) overlaps "category" (0-8) → single merged range.
    expect(findMatchRanges('category', ['cat', 'category'])).toEqual([[0, 8]]);
  });

  it('merges adjacent ranges that touch', () => {
    // "foo" (0-3) and "bar" (3-6) are adjacent and should coalesce.
    expect(findMatchRanges('foobar', ['foo', 'bar'])).toEqual([[0, 6]]);
  });

  it('keeps disjoint ranges separate and sorted', () => {
    expect(findMatchRanges('bar foo', ['foo', 'bar'])).toEqual([
      [0, 3],
      [4, 7],
    ]);
  });

  it('ignores empty terms', () => {
    expect(findMatchRanges('hello', ['', 'lo'])).toEqual([[3, 5]]);
  });
});
