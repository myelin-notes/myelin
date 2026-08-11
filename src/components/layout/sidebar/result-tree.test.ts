import { describe, expect, it } from 'vitest';
import type { VFSFileNode, VFSFolderNode } from '@/lib/sync';
import { buildResultTree, type ResultTreeNode } from './result-tree';

function folder(id: string, parentId: string | null): VFSFolderNode {
  return {
    id,
    name: id,
    type: 'folder',
    parentId,
    tags: [],
    createdAt: 0,
    modifiedAt: 0,
  };
}

function file(id: string, parentId: string | null): VFSFileNode {
  return {
    id,
    name: id,
    type: 'file',
    fileType: 'mcanvas',
    parentId,
    tags: [],
    createdAt: 0,
    modifiedAt: 0,
  };
}

const byRank = (nodes: ResultTreeNode[]) =>
  nodes.sort((a, b) => a.rank - b.rank);

/** Flattens to `id@depth` strings in render order. */
function outline(nodes: ResultTreeNode[], depth = 0): string[] {
  return nodes.flatMap((entry) => [
    `${entry.node.id}@${depth}`,
    ...outline(entry.children, depth + 1),
  ]);
}

describe('buildResultTree', () => {
  it('keeps root-level hits at the root', () => {
    const tree = buildResultTree(
      [file('a', null), file('b', null)],
      [],
      byRank,
    );
    expect(outline(tree)).toEqual(['a@0', 'b@0']);
  });

  it('nests hits under their ancestor folders', () => {
    const tree = buildResultTree(
      [file('deep', 'inner')],
      [folder('outer', null), folder('inner', 'outer')],
      byRank,
    );
    expect(outline(tree)).toEqual(['outer@0', 'inner@1', 'deep@2']);
  });

  it('groups sibling hits under one shared folder', () => {
    const tree = buildResultTree(
      [file('a', 'docs'), file('b', 'docs')],
      [folder('docs', null), folder('docs', null)],
      byRank,
    );
    expect(outline(tree)).toEqual(['docs@0', 'a@1', 'b@1']);
  });

  it('ranks a folder by its best-scoring descendant', () => {
    const tree = buildResultTree(
      [file('top', null), file('buried', 'docs')],
      [folder('docs', null)],
      byRank,
    );
    expect(outline(tree)).toEqual(['top@0', 'docs@0', 'buried@1']);

    const flipped = buildResultTree(
      [file('buried', 'docs'), file('top', null)],
      [folder('docs', null)],
      byRank,
    );
    expect(outline(flipped)).toEqual(['docs@0', 'buried@1', 'top@0']);
  });

  it('does not duplicate a folder that is itself a hit', () => {
    const tree = buildResultTree(
      [folder('docs', null), file('a', 'docs')],
      [folder('docs', null)],
      byRank,
    );
    expect(outline(tree)).toEqual(['docs@0', 'a@1']);
  });

  it('applies the caller ordering at every level', () => {
    const tree = buildResultTree(
      [file('z', 'docs'), file('a', 'docs')],
      [folder('docs', null)],
      (nodes) => nodes.sort((x, y) => x.node.name.localeCompare(y.node.name)),
    );
    expect(outline(tree)).toEqual(['docs@0', 'a@1', 'z@1']);
  });
});
