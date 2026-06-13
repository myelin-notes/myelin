import { CanvasViewport } from '@/pages/canvas/canvas-viewport';
import type { Vector2 } from '@/pages/canvas/geometry';
import type { NoteGraph, NoteGraphEdge, NoteGraphNode } from './types';

const SMALL_GRAPH_NODE_RADIUS = 24;
const DENSE_GRAPH_NODE_RADIUS = 8;
const DENSE_GRAPH_NODE_COUNT = 250;
const MIN_HIT_RADIUS_SCREEN = 14;
const LINK_DISTANCE = 150;
const REPULSION = 9000;
const SPRING = 0.02;
const FRICTION = 0.86;
const COOLING = 0.985;
const MIN_ALPHA = 0.02;
const SELECTION_DURATION = 0.22;

type Rgba = [number, number, number, number];

const NODE_FILL_BASE: Rgba = [255, 255, 255, 0.95];
const NODE_FILL_SELECTED: Rgba = [28, 39, 56, 1];
const NODE_STROKE_BASE: Rgba = [141, 154, 167, 0.2];
const NODE_STROKE_SELECTED: Rgba = [28, 39, 56, 0.42];
const LABEL_FILL_BASE: Rgba = [67, 71, 74, 1];
const LABEL_FILL_SELECTED: Rgba = [28, 39, 56, 1];

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

function lerpRgba(from: Rgba, to: Rgba, t: number): string {
  const r = Math.round(lerp(from[0], to[0], t));
  const g = Math.round(lerp(from[1], to[1], t));
  const b = Math.round(lerp(from[2], to[2], t));
  const a = lerp(from[3], to[3], t);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

export interface GraphLayoutNode {
  id: string;
  label: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  selectionProgress: number;
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

export function graphNodeRadius(totalNodes: number): number {
  if (totalNodes <= 100) {
    return SMALL_GRAPH_NODE_RADIUS;
  }
  if (totalNodes >= 1000) {
    return DENSE_GRAPH_NODE_RADIUS;
  }

  const density = (totalNodes - 100) / 900;
  return SMALL_GRAPH_NODE_RADIUS - density * 16;
}

export function graphEdgeAlpha(totalNodes: number): number {
  if (totalNodes <= 100) {
    return 0.68;
  }
  if (totalNodes >= 1000) {
    return 0.3;
  }

  const density = (totalNodes - 100) / 900;
  return 0.68 - density * 0.38;
}

export function shouldDrawGraphNodeLabel({
  selected,
  totalNodes,
  zoom,
}: {
  selected: boolean;
  totalNodes: number;
  zoom: number;
}): boolean {
  if (selected) {
    return true;
  }
  if (totalNodes > DENSE_GRAPH_NODE_COUNT) {
    return false;
  }
  return zoom >= (totalNodes > 100 ? 1.2 : 0.45);
}

export function createGraphLayout(graph: NoteGraph): GraphLayout {
  const nodeRadius = graphNodeRadius(graph.nodes.length);
  const nodes = graph.nodes.map((node, index) => {
    const point = initialPosition(node.id, index, graph.nodes.length);
    return {
      id: node.id,
      label: node.name,
      x: point.x,
      y: point.y,
      vx: 0,
      vy: 0,
      radius: nodeRadius,
      selectionProgress: 0,
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

export function tickGraphSelection(
  layout: GraphLayout,
  selectedId: string | null,
  deltaTime: number,
): void {
  const stepRaw = deltaTime > 0 ? deltaTime / SELECTION_DURATION : 1;
  const step = Math.min(stepRaw, 1);
  for (const node of layout.nodes) {
    const target = node.id === selectedId ? 1 : 0;
    if (node.selectionProgress === target) {
      continue;
    }
    if (Math.abs(target - node.selectionProgress) <= step) {
      node.selectionProgress = target;
    } else {
      node.selectionProgress += Math.sign(target - node.selectionProgress) * step;
    }
  }
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

  public focusNode(id: string): void {
    const node = this.layout.nodes.find((candidate) => candidate.id === id);
    if (!node) {
      return;
    }

    const size = Math.max(220, node.radius * 16);
    this.viewport.animateViewToFitRect(
      new DOMRect(node.x - size / 2, node.y - size / 2, size, size),
      { widthRatio: 0.42, heightRatio: 0.42 },
    );
  }

  public redraw(deltaTime: number): void {
    tickGraphLayout(this.layout, deltaTime);
    tickGraphSelection(this.layout, this.selectedId, deltaTime);
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
    this.ctx.strokeStyle = `rgba(141, 154, 167, ${graphEdgeAlpha(this.layout.nodes.length)})`;
    this.ctx.lineWidth = 1.1 / this.viewport.zoom;
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
    const totalNodes = this.layout.nodes.length;
    for (const node of this.layout.nodes) {
      const progress = node.selectionProgress;
      const colorT = easeOutCubic(progress);
      const scaleT = easeOutBack(progress);
      const selectedRadius = Math.max(node.radius + 4, node.radius * 1.4);
      const radius = lerp(node.radius, selectedRadius, scaleT);
      this.ctx.fillStyle = lerpRgba(NODE_FILL_BASE, NODE_FILL_SELECTED, colorT);
      this.ctx.beginPath();
      this.ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.strokeStyle = lerpRgba(
        NODE_STROKE_BASE,
        NODE_STROKE_SELECTED,
        colorT,
      );
      this.ctx.lineWidth = lerp(0.8, 1.4, colorT) / this.viewport.zoom;
      this.ctx.stroke();
      if (
        shouldDrawGraphNodeLabel({
          selected: progress > 0.01,
          totalNodes,
          zoom: this.viewport.zoom,
        })
      ) {
        this.drawNodeLabel(node, radius, colorT);
      }
    }
  }

  private drawNodeLabel(
    node: GraphLayoutNode,
    radius: number,
    colorT: number,
  ): void {
    const raisedY = node.y - radius - 10 / this.viewport.zoom;
    const y = lerp(node.y, raisedY, colorT);
    this.ctx.lineWidth = 3 / this.viewport.zoom;
    this.ctx.strokeStyle = 'rgba(247, 249, 251, 0.9)';
    this.ctx.strokeText(node.label, node.x, y);
    this.ctx.fillStyle = lerpRgba(LABEL_FILL_BASE, LABEL_FILL_SELECTED, colorT);
    this.ctx.fillText(node.label, node.x, y);
  }
}
