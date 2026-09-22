import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CanvasRenderer,
  cullMarginWorld,
  reorderDomOverlay,
} from './canvas-renderer';
import { type CanvasViewport, MAX_ZOOM, MIN_ZOOM } from './canvas-viewport';
import type { DrawableElement } from './elements/drawable-element';
import type { PlacementController } from './placement-controller';
import type { SelectionController } from './selection-controller';
import type { ITool } from './tools/tool';

const { frameOrder } = vi.hoisted(() => ({ frameOrder: [] as string[] }));

interface OverlayNode {
  dataset: { elementUuid: string };
  style: { zIndex: string };
  readonly nextElementSibling: OverlayNode | null;
}

function createOverlayHost(uuids: string[]): {
  host: HTMLElement;
  nodes: OverlayNode[];
} {
  const nodes = uuids.map(
    (elementUuid) =>
      ({
        dataset: { elementUuid },
        style: { zIndex: '' },
      }) as OverlayNode,
  );
  for (const node of nodes) {
    Object.defineProperty(node, 'nextElementSibling', {
      get: () => nodes[nodes.indexOf(node) + 1] ?? null,
    });
  }
  const host = {
    children: nodes,
    get firstElementChild() {
      return nodes[0] ?? null;
    },
    insertBefore(node: OverlayNode, expected: OverlayNode | null) {
      const currentIndex = nodes.indexOf(node);
      if (currentIndex >= 0) {
        nodes.splice(currentIndex, 1);
      }
      const expectedIndex = expected === null ? -1 : nodes.indexOf(expected);
      nodes.splice(expectedIndex < 0 ? nodes.length : expectedIndex, 0, node);
    },
  };
  return { host: host as unknown as HTMLElement, nodes };
}

afterEach(() => vi.unstubAllGlobals());

vi.mock('./rendering/painter', () => ({
  WebGLPainter: class {
    beginFrame() {
      frameOrder.push('clear');
      return true;
    }
    endFrame() {
      frameOrder.push('present');
    }
    scale() {}
    translate() {}
  },
}));

it('draws all elements before selection and tool feedback on the same foreground', () => {
  vi.stubGlobal('window', { devicePixelRatio: 1 });
  frameOrder.length = 0;
  const canvas = { clientWidth: 800, clientHeight: 600 } as HTMLCanvasElement;
  const renderer = new CanvasRenderer(canvas);
  const viewport = {
    zoom: 1,
    offset: { x: 0, y: 0 },
    getWorldRect: () => new DOMRect(0, 0, 800, 600),
    screenToWorld: () => ({ x: 0, y: 0 }),
  } as unknown as CanvasViewport;
  const elements = ['ink', 'image'].map((name) => ({
    intersectsWorldRect: () => true,
    draw: (ctx: unknown) => {
      expect(ctx).toBe(renderer.ctx);
      frameOrder.push(name);
    },
  })) as unknown as DrawableElement[];
  const selection = {
    advanceOverlay: () => {},
    drawOverlay: (ctx: unknown) => {
      expect(ctx).toBe(renderer.ctx);
      frameOrder.push('selection');
    },
  } as unknown as SelectionController;
  const tool = {
    drawCursor: () => frameOrder.push('cursor'),
  } as unknown as ITool;
  renderer.redraw(
    0.016,
    viewport,
    elements,
    null,
    tool,
    { x: 0, y: 0 },
    { isActive: false } as PlacementController,
    null,
    selection,
  );
  expect(frameOrder).toEqual([
    'clear',
    'ink',
    'image',
    'selection',
    'cursor',
    'present',
  ]);
});

describe('reorderDomOverlay', () => {
  it('uses the shared canvas position when a page frame occupies another DOM layer', () => {
    const { host, nodes } = createOverlayHost(['pdf']);
    const setPdfZIndex = vi.fn();
    const elements = [
      { uuid: 'page-frame', setDomZIndex: vi.fn() },
      { uuid: 'pdf', setDomZIndex: setPdfZIndex },
    ];

    reorderDomOverlay(host, elements);

    expect(nodes[0].style.zIndex).toBe('2');
    expect(setPdfZIndex).toHaveBeenCalledWith('2');
  });

  it('keeps DOM siblings in their shared canvas order', () => {
    const { host, nodes } = createOverlayHost(['pdf', 'text']);
    const elements = [
      { uuid: 'text', setDomZIndex: vi.fn() },
      { uuid: 'pdf', setDomZIndex: vi.fn() },
    ];

    reorderDomOverlay(host, elements);

    expect(nodes.map((node) => node.dataset.elementUuid)).toEqual([
      'text',
      'pdf',
    ]);
    expect(nodes.map((node) => node.style.zIndex)).toEqual(['1', '2']);
  });
});

describe('cullMarginWorld', () => {
  it('is a constant band in screen pixels, whatever the zoom', () => {
    for (const zoom of [MIN_ZOOM, 0.5, 1, 4, MAX_ZOOM]) {
      expect(cullMarginWorld(zoom) * zoom).toBeCloseTo(128, 6);
    }
  });

  it('shrinks in world units as the view zooms in', () => {
    expect(cullMarginWorld(4)).toBeLessThan(cullMarginWorld(1));
    expect(cullMarginWorld(1)).toBeLessThan(cullMarginWorld(0.25));
  });

  it('culls nothing when the zoom is unusable', () => {
    // Before the viewport has been measured. An unbounded margin keeps every element in frame: a bad
    // frame is recoverable, a blank canvas reads as data loss.
    for (const zoom of [0, -1, Number.NaN]) {
      expect(cullMarginWorld(zoom)).toBe(Number.POSITIVE_INFINITY);
    }
  });
});
