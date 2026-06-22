import type { VFSNodeId } from '@/lib/sync';

export interface NoteGraphEdge {
  id: string;
  sourceId: VFSNodeId;
  targetId: VFSNodeId;
  count: number;
  snippets: string[];
}

export interface NoteGraphNode {
  id: VFSNodeId;
  name: string;
  incomingEdges: NoteGraphEdge[];
  outgoingEdges: NoteGraphEdge[];
}

export interface NoteGraph {
  nodes: NoteGraphNode[];
  edges: NoteGraphEdge[];
  nodesById: Map<VFSNodeId, NoteGraphNode>;
}
