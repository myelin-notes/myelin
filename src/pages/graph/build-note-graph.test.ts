import { describe, expect, it } from 'vitest';
import type { RepositoryNoteGraph } from '@/lib/sync';
import { buildNoteGraph } from './build-note-graph';

const source: RepositoryNoteGraph = {
  nodes: [
    { id: 'a', name: 'Alpha' },
    { id: 'b', name: 'Beta' },
    { id: 'c', name: 'Gamma' },
  ],
  links: [
    {
      sourceId: 'a',
      targetId: 'b',
      pageFrameId: null,
      title: 'Beta',
      snippet: 'See Beta',
    },
    {
      sourceId: 'a',
      targetId: 'b',
      pageFrameId: null,
      title: 'Beta',
      snippet: 'Again',
    },
    {
      sourceId: 'b',
      targetId: 'missing',
      pageFrameId: null,
      title: 'Missing',
      snippet: 'Gone',
    },
    {
      sourceId: 'c',
      targetId: null,
      pageFrameId: null,
      title: 'Unresolved',
      snippet: 'Draft',
    },
  ],
};

describe('buildNoteGraph', () => {
  it('keeps isolated nodes and collapses duplicate resolved edges', () => {
    const graph = buildNoteGraph(source);

    expect(graph.nodes.map((node) => node.id)).toEqual(['a', 'b', 'c']);
    expect(graph.edges).toEqual([
      {
        id: 'a->b',
        sourceId: 'a',
        targetId: 'b',
        count: 2,
        snippets: ['See Beta', 'Again'],
      },
    ]);
  });

  it('precomputes incoming and outgoing edge lists for the inspector', () => {
    const graph = buildNoteGraph(source);

    expect(
      graph.nodesById.get('a')?.outgoingEdges.map((edge) => edge.id),
    ).toEqual(['a->b']);
    expect(
      graph.nodesById.get('b')?.incomingEdges.map((edge) => edge.id),
    ).toEqual(['a->b']);
    expect(graph.nodesById.get('c')?.incomingEdges).toEqual([]);
  });
});
