import { describe, expect, it } from 'vitest';
import {
  buildTagTree,
  expandTagWithAncestors,
  indexTagTree,
  nodeMatchesAnyTag,
  normalizeTagInput,
  orderTagsHierarchically,
  tagMatchesQuery,
  toggleTagSelection,
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
});

describe('buildTagTree', () => {
  it('nests descendants under their parent and labels by trailing segment', () => {
    const tree = buildTagTree([
      { tag: 'uni', count: 10 },
      { tag: 'uni/math', count: 6 },
      { tag: 'uni/math/calc', count: 4 },
    ]);
    expect(tree).toEqual([
      {
        tag: 'uni',
        label: 'uni',
        count: 10,
        children: [
          {
            tag: 'uni/math',
            label: 'math',
            count: 6,
            children: [
              { tag: 'uni/math/calc', label: 'calc', count: 4, children: [] },
            ],
          },
        ],
      },
    ]);
  });

  it('orders roots and siblings by count with an alphabetical tie-break', () => {
    const tree = buildTagTree([
      { tag: 'a', count: 5 },
      { tag: 'b', count: 9 },
      { tag: 'a/low', count: 1 },
      { tag: 'a/high', count: 4 },
    ]);
    expect(tree.map((node) => node.tag)).toEqual(['b', 'a']);
    expect(tree[1].children.map((node) => node.tag)).toEqual([
      'a/high',
      'a/low',
    ]);
  });

  it('treats a tag whose parent is absent as a root', () => {
    const tree = buildTagTree([{ tag: 'orphan/child', count: 7 }]);
    expect(tree).toEqual([
      { tag: 'orphan/child', label: 'child', count: 7, children: [] },
    ]);
  });
});

describe('toggleTagSelection', () => {
  const tags = [
    { tag: 'a', count: 0 },
    { tag: 'a/b', count: 0 },
    { tag: 'a/c', count: 0 },
    { tag: 'a/b/d', count: 0 },
    { tag: 'x', count: 0 },
  ];
  const byTag = indexTagTree(buildTagTree(tags));
  const toggle = (active: string[], tag: string) =>
    [...toggleTagSelection(new Set(active), tag, byTag)].sort();

  it('selects a leaf and leaves siblings untouched', () => {
    expect(toggle([], 'a/c')).toEqual(['a/c']);
  });

  it('selecting a parent stays compact and drops redundant descendants', () => {
    expect(toggle(['a/b', 'a/c'], 'a')).toEqual(['a']);
  });

  it('deselecting a directly-selected tag just removes it', () => {
    expect(toggle(['a', 'x'], 'a')).toEqual(['x']);
  });

  it('deselecting a child pushes the parent coverage down to siblings', () => {
    // "a" covers the whole subtree; unchecking "a/b" must keep "a/c" selected
    // (and not re-add the deselected branch).
    expect(toggle(['a'], 'a/b')).toEqual(['a/c']);
  });

  it('pushes coverage down through multiple levels', () => {
    // Unchecking the deep "a/b/d" keeps the "a/c" branch and the "a/b" level
    // minus the removed leaf.
    expect(toggle(['a'], 'a/b/d')).toEqual(['a/c']);
  });

  it('selecting a partially-selected parent fills the whole subtree', () => {
    expect(toggle(['a/c'], 'a')).toEqual(['a']);
  });
});

describe('indexTagTree', () => {
  it('indexes every node by its full tag', () => {
    const index = indexTagTree(
      buildTagTree([
        { tag: 'a', count: 1 },
        { tag: 'a/b', count: 2 },
      ]),
    );
    expect([...index.keys()].sort()).toEqual(['a', 'a/b']);
    expect(index.get('a/b')?.label).toBe('b');
  });
});
