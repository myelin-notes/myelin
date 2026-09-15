import { describe, expect, it, type Mock, vi } from 'vitest';
import type { PdfPageOrderEntry } from '../../pdf-renderer';
import { buildPdfLayout, type PdfLayout } from './layout';
import { PdfPageView } from './page-view';
import type { PdfPageSurface } from './render-scheduler';

interface TestPageDom extends PdfPageSurface {
  root: HTMLDivElement & { remove: Mock<() => void> };
}

function createPageDom(width: number, height: number): TestPageDom {
  return {
    root: {
      remove: vi.fn(),
      style: {},
    } as unknown as TestPageDom['root'],
    canvas: {
      width,
      height,
      getContext: () => ({ drawImage: vi.fn() }),
    } as unknown as HTMLCanvasElement,
    renderHandle: null,
    rendered: { pageIndex: 0, renderScale: 1 },
    rendering: null,
    pendingRender: null,
  };
}

function createLayout(pageOrder: PdfPageOrderEntry[]): PdfLayout {
  return buildPdfLayout({
    pageSizes: [
      { w: 612, h: 792 },
      { w: 300, h: 150 },
      { w: 400, h: 200 },
    ],
    pageOrder,
    pageLayout: 'vertical',
    defaultPageSize: { w: 680, h: 880 },
  });
}

function testablePageView() {
  return new PdfPageView({ onRenderError: vi.fn() }) as unknown as {
    pageDoms: Map<number, TestPageDom>;
    reconcileOrder(
      previousPages: PdfLayout['pages'],
      nextPages: PdfLayout['pages'],
      document: null,
    ): void;
    syncPageGeometry(
      pageDom: TestPageDom,
      page: PdfLayout['pages'][number],
      scaleX: number,
      scaleY: number,
      rasterZoom: number,
    ): void;
  };
}

describe('PdfPageView', () => {
  it('preserves rendered page surfaces when a blank page is inserted', () => {
    const view = testablePageView();
    const first = createPageDom(612, 792);
    const second = createPageDom(300, 150);
    first.rendered = { pageIndex: 0, renderScale: 1 };
    second.rendered = { pageIndex: 1, renderScale: 1 };
    view.pageDoms = new Map([
      [0, first],
      [1, second],
    ]);
    const previous = createLayout([
      { kind: 'pdf', originalIndex: 0 },
      { kind: 'pdf', originalIndex: 1 },
    ]);
    const next = createLayout([
      { kind: 'pdf', originalIndex: 0 },
      { kind: 'blank', size: { w: 612, h: 792 } },
      { kind: 'pdf', originalIndex: 1 },
    ]);

    view.reconcileOrder(previous.pages, next.pages, null);

    expect(view.pageDoms.get(0)).toBe(first);
    expect(view.pageDoms.get(2)).toBe(second);
    expect(first.root.remove).not.toHaveBeenCalled();
    expect(second.root.remove).not.toHaveBeenCalled();
    expect(first.canvas).toMatchObject({ width: 612, height: 792 });
    expect(second.canvas).toMatchObject({ width: 300, height: 150 });
  });

  it('disposes only the removed surface when a source page is deleted', () => {
    const view = testablePageView();
    const first = createPageDom(612, 792);
    const removed = createPageDom(300, 150);
    const third = createPageDom(400, 200);
    first.rendered = { pageIndex: 0, renderScale: 1 };
    removed.rendered = { pageIndex: 1, renderScale: 1 };
    third.rendered = { pageIndex: 2, renderScale: 1 };
    view.pageDoms = new Map([
      [0, first],
      [1, removed],
      [2, third],
    ]);
    const previous = createLayout([
      { kind: 'pdf', originalIndex: 0 },
      { kind: 'pdf', originalIndex: 1 },
      { kind: 'pdf', originalIndex: 2 },
    ]);
    const next = createLayout([
      { kind: 'pdf', originalIndex: 0 },
      { kind: 'pdf', originalIndex: 2 },
    ]);

    view.reconcileOrder(previous.pages, next.pages, null);

    expect(view.pageDoms.get(0)).toBe(first);
    expect(view.pageDoms.get(1)).toBe(third);
    expect(first.root.remove).not.toHaveBeenCalled();
    expect(third.root.remove).not.toHaveBeenCalled();
    expect(removed.root.remove).toHaveBeenCalledOnce();
    expect(removed.canvas).toMatchObject({ width: 1, height: 1 });
  });

  it('lays page surfaces out in rasterized chrome units', () => {
    const view = testablePageView();
    const pageDom = createPageDom(1, 1);
    const page = {
      kind: 'pdf' as const,
      originalIndex: 0,
      size: { w: 100, h: 200 },
      localLeft: 10,
      localTop: 20,
    };

    view.syncPageGeometry(pageDom, page, 2, 0.5, 1.25);

    expect(pageDom.root.style.transform).toBe('translate(25px, 12.5px)');
    expect(pageDom.root.style.width).toBe('250px');
    expect(pageDom.root.style.height).toBe('125px');
  });
});
