import { describe, expect, it } from 'vitest';
import {
  expandTagWithAncestors,
  nodeMatchesAnyTag,
  normalizeTagInput,
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
