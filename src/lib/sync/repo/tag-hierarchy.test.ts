import { describe, expect, it } from 'vitest';
import {
  expandTagWithAncestors,
  nodeMatchesAnyTag,
  normalizeTagInput,
  orderTagsHierarchically,
  tagMatchesQuery,
} from './tag-hierarchy';

describe('tagMatchesQuery', () => {
  it('matches a stored tag against itself and its descendants', () => {
    expect(tagMatchesQuery('uni', 'uni')).toBe(true);
    expect(tagMatchesQuery('uni/math', 'uni')).toBe(true);
    expect(tagMatchesQuery('uni/math/calc', 'uni')).toBe(true);
  });

  it('does not treat a shared prefix without a slash as a match', () => {
    expect(tagMatchesQuery('unique', 'uni')).toBe(false);
    expect(tagMatchesQuery('university/x', 'uni')).toBe(false);
    expect(tagMatchesQuery('alphabet', 'alpha')).toBe(false);
  });

  it('matches a nested query against itself and its descendants only', () => {
    expect(tagMatchesQuery('uni/math', 'uni/math')).toBe(true);
    expect(tagMatchesQuery('uni/math/calc', 'uni/math')).toBe(true);
    expect(tagMatchesQuery('uni', 'uni/math')).toBe(false);
  });

  it('is case-sensitive', () => {
    expect(tagMatchesQuery('Uni', 'uni')).toBe(false);
  });
});

describe('nodeMatchesAnyTag', () => {
  it('matches when a stored tag is a descendant of a query tag', () => {
    expect(nodeMatchesAnyTag(['uni/math'], ['uni'])).toBe(true);
  });

  it('does not match a more specific query against an ancestor stored tag', () => {
    expect(nodeMatchesAnyTag(['uni'], ['uni/math'])).toBe(false);
  });

  it('matches the exact stored tag when the query equals it', () => {
    expect(nodeMatchesAnyTag(['uni/math'], ['uni/math'])).toBe(true);
  });

  it('uses OR semantics across multiple query tags', () => {
    expect(nodeMatchesAnyTag(['uni/math'], ['other', 'uni'])).toBe(true);
    expect(nodeMatchesAnyTag(['uni/math'], ['other', 'nope'])).toBe(false);
  });

  it('returns false for an empty query list', () => {
    expect(nodeMatchesAnyTag(['uni/math'], [])).toBe(false);
  });
});

describe('expandTagWithAncestors', () => {
  it('expands a nested tag into its ancestor chain', () => {
    expect(expandTagWithAncestors('a/b/c')).toEqual(['a', 'a/b', 'a/b/c']);
  });

  it('returns a single-element chain for a flat tag', () => {
    expect(expandTagWithAncestors('flat')).toEqual(['flat']);
  });
});

describe('normalizeTagInput', () => {
  it('collapses empty segments', () => {
    expect(normalizeTagInput('uni//math')).toBe('uni/math');
  });

  it('trims whitespace around segments', () => {
    expect(normalizeTagInput(' a / b ')).toBe('a/b');
  });

  it('drops leading and trailing slashes', () => {
    expect(normalizeTagInput('/x')).toBe('x');
    expect(normalizeTagInput('x/')).toBe('x');
  });

  it('returns an empty string for empty input', () => {
    expect(normalizeTagInput('')).toBe('');
  });

  it('does not strip a leading hash', () => {
    expect(normalizeTagInput('#a')).toBe('#a');
    expect(normalizeTagInput('#a/b')).toBe('#a/b');
  });
});

describe('orderTagsHierarchically', () => {
  const order = (tags: { tag: string; count: number }[]) =>
    orderTagsHierarchically(tags).map((entry) => entry.tag);

  it('places each parent immediately before its descendant subtree', () => {
    expect(
      order([
        { tag: 'uni', count: 10 },
        { tag: 'work', count: 8 },
        { tag: 'uni/math', count: 6 },
        { tag: 'uni/math/calc', count: 4 },
      ]),
    ).toEqual(['uni', 'uni/math', 'uni/math/calc', 'work']);
  });

  it('keeps families ordered by count and sorts siblings by count', () => {
    expect(
      order([
        { tag: 'a', count: 5 },
        { tag: 'b', count: 9 },
        { tag: 'a/low', count: 1 },
        { tag: 'a/high', count: 4 },
      ]),
    ).toEqual(['b', 'a', 'a/high', 'a/low']);
  });

  it('leaves a flat list untouched', () => {
    expect(
      order([
        { tag: 'x', count: 3 },
        { tag: 'y', count: 2 },
      ]),
    ).toEqual(['x', 'y']);
  });

  it('treats a tag whose parent is absent as a root rather than dropping it', () => {
    expect(
      order([
        { tag: 'orphan/child', count: 7 },
        { tag: 'solo', count: 2 },
      ]),
    ).toEqual(['orphan/child', 'solo']);
  });

  it('annotates depth and a leaf label per nesting level', () => {
    expect(
      orderTagsHierarchically([
        { tag: 'uni', count: 10 },
        { tag: 'uni/math', count: 6 },
        { tag: 'uni/math/calc', count: 4 },
      ]),
    ).toEqual([
      { tag: 'uni', count: 10, depth: 0, label: 'uni' },
      { tag: 'uni/math', count: 6, depth: 1, label: 'math' },
      { tag: 'uni/math/calc', count: 4, depth: 2, label: 'calc' },
    ]);
  });

  it('keeps the full path as the label for a parentless root', () => {
    expect(
      orderTagsHierarchically([{ tag: 'orphan/child', count: 7 }]),
    ).toEqual([
      { tag: 'orphan/child', count: 7, depth: 0, label: 'orphan/child' },
    ]);
  });
});
