import type { RepositoryNoteGraph } from '@/lib/sync';

/**
 * Narrow a note-graph source to a set of node ids (the files in the current
 * lens/selection). Links whose endpoints fall outside the set are dropped when
 * the graph is rebuilt, so only intra-selection connections remain.
 */
export function scopeNoteGraphSource(
  source: RepositoryNoteGraph,
  ids: ReadonlySet<string>,
): RepositoryNoteGraph {
  return {
    ...source,
    nodes: source.nodes.filter((node) => ids.has(node.id)),
  };
}
