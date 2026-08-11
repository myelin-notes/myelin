import type { VFSFolderNode, VFSNode } from '@/lib/sync';

export interface ResultTreeNode {
  node: VFSNode;
  /**
   * Lowest result index in this subtree. Folders pulled in only to hold a hit
   * inherit their best descendant's rank so relevance order survives nesting.
   */
  rank: number;
  children: ResultTreeNode[];
}

/**
 * Rebuilds the folder hierarchy around a flat result list, so search and tag
 * hits render under their real parents instead of all at the root. `ancestors`
 * must cover every result's parent chain; a hit whose chain is missing is
 * dropped rather than surfaced at the wrong depth.
 */
export function buildResultTree(
  results: VFSNode[],
  ancestors: VFSFolderNode[],
  sortLevel: (nodes: ResultTreeNode[]) => ResultTreeNode[],
): ResultTreeNode[] {
  const rankById = new Map<string, number>();
  const included = new Map<string, VFSNode>();
  results.forEach((node, index) => {
    rankById.set(node.id, index);
    included.set(node.id, node);
  });
  for (const folder of ancestors) {
    if (!included.has(folder.id)) {
      included.set(folder.id, folder);
    }
  }

  const byParent = new Map<string | null, VFSNode[]>();
  for (const node of included.values()) {
    const siblings = byParent.get(node.parentId);
    if (siblings) {
      siblings.push(node);
    } else {
      byParent.set(node.parentId, [node]);
    }
  }

  const build = (parentId: string | null): ResultTreeNode[] => {
    const nodes = (byParent.get(parentId) ?? []).map((node) => {
      const children = node.type === 'folder' ? build(node.id) : [];
      const rank = Math.min(
        rankById.get(node.id) ?? Number.POSITIVE_INFINITY,
        ...children.map((child) => child.rank),
      );
      return { node, rank, children };
    });
    return sortLevel(nodes);
  };

  return build(null);
}
