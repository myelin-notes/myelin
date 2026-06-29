import { describe, expect, it } from 'vitest';
import {
  createGraphLayout,
  getGraphBounds,
  graphEdgeAlpha,
  graphNodeRadius,
  hitTestGraphNode,
  shouldDrawGraphNodeLabel,
  tickGraphLayout,
  tickGraphSelection,
} from './graph-canvas-controller';
import type { NoteGraph } from './types';

const graph: NoteGraph = {
  nodes: [
    { id: 'a', name: 'Alpha', tags: [], incomingEdges: [], outgoingEdges: [] },
    { id: 'b', name: 'Beta', tags: [], incomingEdges: [], outgoingEdges: [] },
  ],
  edges: [
    {
      id: 'a->b',
      sourceId: 'a',
      targetId: 'b',
      count: 1,
      snippets: ['See Beta'],
    },
  ],
  nodesById: new Map(),
};

graph.nodesById.set('a', graph.nodes[0]);
graph.nodesById.set('b', graph.nodes[1]);

function graphWithNodeCount(totalNodes: number): NoteGraph {
  const nodes = Array.from({ length: totalNodes }, (_, index) => ({
    id: `node-${index}`,
    name: `Node ${index}`,
    tags: [],
    incomingEdges: [],
    outgoingEdges: [],
  }));
  return {
    nodes,
    edges: [],
    nodesById: new Map(nodes.map((node) => [node.id, node])),
  };
}

describe('graph layout helpers', () => {
  it('creates deterministic node positions', () => {
    const first = createGraphLayout(graph);
    const second = createGraphLayout(graph);

    expect(
      first.nodes.map((node) => ({ id: node.id, x: node.x, y: node.y })),
    ).toEqual(
      second.nodes.map((node) => ({ id: node.id, x: node.x, y: node.y })),
    );
  });

  it('hit tests nodes with a screen-space minimum radius', () => {
    const layout = createGraphLayout(graph);
    const node = layout.nodes[0];

    expect(hitTestGraphNode(layout, { x: node.x + 4, y: node.y }, 1)?.id).toBe(
      node.id,
    );
    expect(
      hitTestGraphNode(layout, { x: node.x + 80, y: node.y }, 1),
    ).toBeNull();
  });

  it('computes graph bounds including node radius', () => {
    const layout = createGraphLayout(graph);
    const bounds = getGraphBounds(layout);

    expect(bounds.width).toBeGreaterThan(0);
    expect(bounds.height).toBeGreaterThan(0);
  });

  it('cools the layout after ticks', () => {
    const layout = createGraphLayout(graph);
    const initialAlpha = layout.alpha;

    tickGraphLayout(layout, 1 / 60);

    expect(layout.alpha).toBeLessThan(initialAlpha);
  });

  it('scales visual weight down for dense graphs', () => {
    expect(graphNodeRadius(1000)).toBeLessThan(graphNodeRadius(20));
    expect(graphEdgeAlpha(1000)).toBeLessThan(graphEdgeAlpha(20));
    expect(createGraphLayout(graphWithNodeCount(1000)).nodes[0].radius).toBe(
      graphNodeRadius(1000),
    );
  });

  it('eases selection progress toward the selected node', () => {
    const layout = createGraphLayout(graph);
    expect(layout.nodes.every((node) => node.selectionProgress === 0)).toBe(
      true,
    );

    tickGraphSelection(layout, 'a', 1 / 60);
    const selected = layout.nodes.find((node) => node.id === 'a');
    const other = layout.nodes.find((node) => node.id === 'b');
    expect(selected?.selectionProgress).toBeGreaterThan(0);
    expect(selected?.selectionProgress).toBeLessThan(1);
    expect(other?.selectionProgress).toBe(0);

    for (let frame = 0; frame < 60; frame += 1) {
      tickGraphSelection(layout, 'a', 1 / 60);
    }
    expect(selected?.selectionProgress).toBe(1);

    tickGraphSelection(layout, null, 10);
    expect(selected?.selectionProgress).toBe(0);
  });

  it('keeps dense graph labels focused on selected nodes', () => {
    expect(
      shouldDrawGraphNodeLabel({
        selected: false,
        totalNodes: 1000,
        zoom: 3,
      }),
    ).toBe(false);
    expect(
      shouldDrawGraphNodeLabel({
        selected: true,
        totalNodes: 1000,
        zoom: 0.2,
      }),
    ).toBe(true);
  });
});
