import type { RepositoryNoteGraph, VFSNodeId } from '@/lib/sync';
import type { NoteGraph, NoteGraphEdge, NoteGraphNode } from './types';

function edgeId(sourceId: VFSNodeId, targetId: VFSNodeId): string {
  return `${sourceId}->${targetId}`;
}

export function buildNoteGraph(source: RepositoryNoteGraph): NoteGraph {
  const nodes: NoteGraphNode[] = source.nodes.map((node) => ({
    id: node.id,
    name: node.name,
    incomingEdges: [],
    outgoingEdges: [],
  }));
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const edgesById = new Map<string, NoteGraphEdge>();

  for (const link of source.links) {
    if (
      !link.targetId ||
      !nodesById.has(link.sourceId) ||
      !nodesById.has(link.targetId)
    ) {
      continue;
    }

    const id = edgeId(link.sourceId, link.targetId);
    const existing = edgesById.get(id);
    if (existing) {
      existing.count += 1;
      existing.snippets.push(link.snippet);
      continue;
    }

    edgesById.set(id, {
      id,
      sourceId: link.sourceId,
      targetId: link.targetId,
      count: 1,
      snippets: [link.snippet],
    });
  }

  const edges = Array.from(edgesById.values());
  for (const edge of edges) {
    nodesById.get(edge.sourceId)?.outgoingEdges.push(edge);
    nodesById.get(edge.targetId)?.incomingEdges.push(edge);
  }

  return { nodes, edges, nodesById };
}
