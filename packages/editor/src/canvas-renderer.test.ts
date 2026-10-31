import { describe, expect, it, vi } from 'vitest';
import {
  backgroundGridLevel,
  cullMarginWorld,
  reorderDomOverlay,
} from './canvas-renderer';
import { MAX_ZOOM, MIN_ZOOM } from './canvas-viewport';
import { LatexElement } from './elements/latex/element';
import { PageFrameElement } from './elements/page-frame-element';
import { PdfElement } from './elements/pdf';
import { ShapeElement } from './elements/shape-element';
import type { StrokeStyle } from './elements/stroke-element';

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

describe('backgroundGridLevel', () => {
  // Alpha of the line at world x = 24 * index, as the renderer draws it.
  const lineAlpha = (index: number, zoom: number) => {
    const { step, minorAlpha } = backgroundGridLevel(zoom);
    const units = (index * 24) / step;
    if (!Number.isInteger(units)) {
      return 0;
    }
    return units % 2 === 0 ? 1 : minorAlpha;
  };

  it('draws every line at full strength at 100%', () => {
    for (let index = 0; index < 8; index++) {
      expect(lineAlpha(index, 1)).toBe(1);
    }
  });

  it('never packs drawn lines tighter than 12 screen px', () => {
    for (let zoom = MIN_ZOOM; zoom <= MAX_ZOOM; zoom *= 1.01) {
      const { step, minorAlpha } = backgroundGridLevel(zoom);
      expect(step * zoom).toBeGreaterThanOrEqual(12);
      // A level twice as coarse would also clear the minimum, so this one is not over-thinned.
      if (step > 24) {
        expect(step * zoom).toBeLessThan(24);
      }
      expect(minorAlpha).toBeGreaterThanOrEqual(0);
      expect(minorAlpha).toBeLessThanOrEqual(1);
    }
  });

  it('fades lines in and out without popping as the zoom changes', () => {
    // A level change that is not continuous flickers the grid on every zoom gesture.
    let previous = Array.from({ length: 64 }, (_, index) =>
      lineAlpha(index, MIN_ZOOM),
    );
    for (let zoom = MIN_ZOOM; zoom <= MAX_ZOOM; zoom *= 1.001) {
      const current = previous.map((_, index) => lineAlpha(index, zoom));
      for (let index = 0; index < current.length; index++) {
        expect(Math.abs(current[index] - previous[index])).toBeLessThan(0.01);
      }
      previous = current;
    }
  });

  it('falls back to the base level for an unusable zoom', () => {
    // A zero or NaN zoom would otherwise never satisfy the spacing loop.
    expect(backgroundGridLevel(0).step).toBe(24);
    expect(backgroundGridLevel(Number.NaN).step).toBe(24);
  });
});

describe('cullMarginWorld', () => {
  it('is a constant band in screen pixels, whatever the zoom', () => {
    for (const zoom of [MIN_ZOOM, 0.5, 1, 4, MAX_ZOOM]) {
      expect(cullMarginWorld(zoom) * zoom).toBeCloseTo(128, 6);
    }
  });

  it('culls nothing when the zoom is unusable', () => {
    // Before the viewport has been measured. An unbounded margin keeps every element in frame: a bad
    // frame is recoverable, a blank canvas reads as data loss.
    for (const zoom of [0, -1, Number.NaN]) {
      expect(cullMarginWorld(zoom)).toBe(Number.POSITIVE_INFINITY);
    }
  });
});

function createCanvasLayer(): HTMLElement {
  return { style: { zIndex: '' } } as unknown as HTMLElement;
}

function zIndexOf(target: { style: { zIndex: string } }): number {
  return Number(target.style.zIndex);
}

const SHAPE_STYLE: StrokeStyle = { color: '#191c1e', size: 8 };

describe('reorderDomOverlay', () => {
  it('uses the shared canvas position when a page frame occupies another DOM layer', () => {
    const { host, nodes } = createOverlayHost(['pdf']);
    const pdf = new PdfElement('pdf');
    const setPdfZIndex = vi.spyOn(pdf, 'setDomZIndex');
    const elements = [new PageFrameElement('page-frame'), pdf];

    reorderDomOverlay(host, createCanvasLayer(), elements, elements);

    expect(nodes[0].style.zIndex).toBe('2');
    expect(setPdfZIndex).toHaveBeenCalledWith('2');
  });

  it('keeps DOM siblings in their shared canvas order', () => {
    const { host, nodes } = createOverlayHost(['latex', 'pdf']);
    const elements = [new PdfElement('pdf'), new LatexElement('latex')];

    reorderDomOverlay(host, createCanvasLayer(), elements, elements);

    expect(nodes.map((node) => node.dataset.elementUuid)).toEqual([
      'pdf',
      'latex',
    ]);
    expect(nodes.map((node) => node.style.zIndex)).toEqual(['1', '2']);
  });

  it('stacks canvas content over backdrops however many precede it', () => {
    const { host, nodes } = createOverlayHost(['pdf']);
    const canvas = createCanvasLayer();
    const frames = Array.from(
      { length: 12 },
      (_, i) => new PageFrameElement(`frame-${i}`),
    );
    const shape = new ShapeElement(
      'shape',
      'rect',
      [0, 0, 200, 100],
      SHAPE_STYLE,
    );
    const elements = [...frames, new PdfElement('pdf'), shape];

    reorderDomOverlay(host, canvas, elements, elements);

    expect(zIndexOf(canvas)).toBeGreaterThan(zIndexOf(nodes[0]));
  });

  it('stacks a DOM element under overlapping canvas content that follows it', () => {
    const { host, nodes } = createOverlayHost(['latex']);
    const canvas = createCanvasLayer();
    const latex = new LatexElement('latex');
    latex.setOffset(10, 20);
    const shape = new ShapeElement(
      'shape',
      'rect',
      [0, 0, 200, 100],
      SHAPE_STYLE,
    );
    const elements = [latex, shape];

    reorderDomOverlay(host, canvas, elements, elements);

    expect(zIndexOf(nodes[0])).toBeLessThan(zIndexOf(canvas));
  });

  it('keeps a DOM element over overlapping canvas content that precedes it, even with more after it', () => {
    const { host, nodes } = createOverlayHost(['latex']);
    const canvas = createCanvasLayer();
    const latex = new LatexElement('latex');
    latex.setOffset(10, 20);
    const elements = [
      new ShapeElement('below', 'rect', [0, 0, 200, 100], SHAPE_STYLE),
      latex,
      new ShapeElement('above', 'rect', [0, 0, 200, 100], SHAPE_STYLE),
    ];

    reorderDomOverlay(host, canvas, elements, elements);

    expect(zIndexOf(nodes[0])).toBeGreaterThan(zIndexOf(canvas));
  });
});
