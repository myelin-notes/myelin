import { CanvasViewport } from '@/pages/canvas/canvas-viewport';
import type { Vector2 } from '@/pages/canvas/geometry';
import type { NoteGraph, NoteGraphEdge, NoteGraphNode } from './types';

const NODE_RADIUS = 30;
const MIN_HIT_RADIUS_SCREEN = 14;
const LINK_DISTANCE = 150;
const REPULSION = 9000;
const SPRING = 0.02;
const FRICTION = 0.86;
const COOLING = 0.985;
const MIN_ALPHA = 0.02;

export interface GraphLayoutNode {
  id: string;
  label: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  source: NoteGraphNode;
}

export interface GraphLayoutEdge {
  id: string;
  source: GraphLayoutNode;
  target: GraphLayoutNode;
  sourceEdge: NoteGraphEdge;
}

export interface GraphLayout {
  nodes: GraphLayoutNode[];
  edges: GraphLayoutEdge[];
  alpha: number;
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function initialPosition(id: string, index: number, total: number): Vector2 {
  const hash = hashString(id);
  const angle = total <= 1 ? 0 : (Math.PI * 2 * index) / total;
  const radius = 120 + (hash % 90);
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
  };
}

export function createGraphLayout(graph: NoteGraph): GraphLayout {
  const nodes = graph.nodes.map((node, index) => {
    const point = initialPosition(node.id, index, graph.nodes.length);
    return {
      id: node.id,
      label: node.name,
      x: point.x,
      y: point.y,
      vx: 0,
      vy: 0,
      radius: NODE_RADIUS,
      source: node,
    };
  });
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const edges = graph.edges.flatMap((edge) => {
    const source = byId.get(edge.sourceId);
    const target = byId.get(edge.targetId);
    return source && target
      ? [{ id: edge.id, source, target, sourceEdge: edge }]
      : [];
  });

  return { nodes, edges, alpha: 1 };
}

export function tickGraphLayout(layout: GraphLayout, deltaTime: number): void {
  if (layout.alpha < MIN_ALPHA) {
    return;
  }

  for (let i = 0; i < layout.nodes.length; i += 1) {
    const left = layout.nodes[i];
    for (let j = i + 1; j < layout.nodes.length; j += 1) {
      const right = layout.nodes[j];
      const dx = right.x - left.x || 0.01;
      const dy = right.y - left.y || 0.01;
      const distanceSq = Math.max(dx * dx + dy * dy, 100);
      const force = (REPULSION * layout.alpha) / distanceSq;
      const distance = Math.sqrt(distanceSq);
      const fx = (dx / distance) * force;
      const fy = (dy / distance) * force;
      left.vx -= fx;
      left.vy -= fy;
      right.vx += fx;
      right.vy += fy;
    }
  }

  for (const edge of layout.edges) {
    const dx = edge.target.x - edge.source.x;
    const dy = edge.target.y - edge.source.y;
    const distance = Math.max(Math.hypot(dx, dy), 1);
    const force = (distance - LINK_DISTANCE) * SPRING * layout.alpha;
    const fx = (dx / distance) * force;
    const fy = (dy / distance) * force;
    edge.source.vx += fx;
    edge.source.vy += fy;
    edge.target.vx -= fx;
    edge.target.vy -= fy;
  }

  const step = Math.min(deltaTime * 60, 2);
  for (const node of layout.nodes) {
    node.vx *= FRICTION;
    node.vy *= FRICTION;
    node.x += node.vx * step;
    node.y += node.vy * step;
  }
  layout.alpha *= COOLING;
}

export function getGraphBounds(layout: GraphLayout): DOMRect {
  if (layout.nodes.length === 0) {
    return new DOMRect(-100, -100, 200, 200);
  }

  const left = Math.min(...layout.nodes.map((node) => node.x - node.radius));
  const top = Math.min(...layout.nodes.map((node) => node.y - node.radius));
  const right = Math.max(...layout.nodes.map((node) => node.x + node.radius));
  const bottom = Math.max(...layout.nodes.map((node) => node.y + node.radius));
  return new DOMRect(left, top, right - left, bottom - top);
}

export function hitTestGraphNode(
  layout: GraphLayout,
  world: Vector2,
  zoom: number,
): GraphLayoutNode | null {
  const minRadius = MIN_HIT_RADIUS_SCREEN / Math.max(zoom, 0.01);
  for (let index = layout.nodes.length - 1; index >= 0; index -= 1) {
    const node = layout.nodes[index];
    const radius = Math.max(node.radius, minRadius);
    if (Math.hypot(world.x - node.x, world.y - node.y) <= radius) {
      return node;
    }
  }
  return null;
}

export class GraphCanvasController {
  public readonly viewport: CanvasViewport;
  private readonly ctx: CanvasRenderingContext2D;
  private layout: GraphLayout;
  private selectedId: string | null = null;

  public constructor(
    private readonly canvas: HTMLCanvasElement,
    graph: NoteGraph,
  ) {
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) {
      throw new Error('Could not create graph canvas context');
    }
    this.ctx = ctx;
    this.viewport = new CanvasViewport(canvas);
    this.layout = createGraphLayout(graph);
    this.viewport.setContentBoundsProvider(() => getGraphBounds(this.layout));
  }

  public setGraph(graph: NoteGraph): void {
    this.layout = createGraphLayout(graph);
    this.viewport.setContentBoundsProvider(() => getGraphBounds(this.layout));
  }

  public setSelectedId(id: string | null): void {
    this.selectedId = id;
  }

  public hitTest(screen: Vector2): GraphLayoutNode | null {
    return hitTestGraphNode(
      this.layout,
      this.viewport.screenToWorld(screen),
      this.viewport.zoom,
    );
  }

  public fit(): void {
    this.viewport.animateViewToFitRect(getGraphBounds(this.layout), {
      widthRatio: 0.72,
      heightRatio: 0.72,
    });
  }

  public redraw(deltaTime: number): void {
    tickGraphLayout(this.layout, deltaTime);
    this.draw();
  }

  public destroy(): void {
    this.viewport.destroy();
  }

  private draw(): void {
    const dpr = window.devicePixelRatio || 1;
    const width = this.canvas.width / dpr;
    const height = this.canvas.height / dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.clearRect(0, 0, width, height);
    this.ctx.fillStyle = '#f7f9fb';
    this.ctx.fillRect(0, 0, width, height);

    this.ctx.save();
    this.ctx.scale(this.viewport.zoom, this.viewport.zoom);
    this.ctx.translate(this.viewport.offset.x, this.viewport.offset.y);
    this.drawEdges();
    this.drawNodes();
    this.ctx.restore();
  }

  private drawEdges(): void {
    this.ctx.strokeStyle = 'rgba(141, 154, 167, 0.72)';
    this.ctx.lineWidth = 1.4 / this.viewport.zoom;
    for (const edge of this.layout.edges) {
      this.ctx.beginPath();
      this.ctx.moveTo(edge.source.x, edge.source.y);
      this.ctx.lineTo(edge.target.x, edge.target.y);
      this.ctx.stroke();
    }
  }

  private drawNodes(): void {
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.font = `${12 / this.viewport.zoom}px Inter, sans-serif`;
    for (const node of this.layout.nodes) {
      const selected = node.id === this.selectedId;
      this.ctx.fillStyle = selected ? '#1c2738' : '#ffffff';
      this.ctx.beginPath();
      this.ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
      this.ctx.fill();
      if (this.viewport.zoom >= 0.45) {
        this.ctx.fillStyle = selected ? '#ffffff' : '#43474a';
        this.ctx.fillText(node.label, node.x, node.y);
      }
    }
  }
}
