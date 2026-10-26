import type { PDFDocumentProxy } from 'pdfjs-dist';
import { Logger } from '@myelin/shared/logger';
import type { CanvasViewport } from '../../canvas-viewport';
import {
  cleanupPdfPage,
  getPdfRenderScale,
  renderPdfTextLayer,
} from '../../pdf-renderer';
import { setStyleIfChanged } from '../../utils/style-cache';
import type { PageLayout } from '../page-frame-constants';
import {
  getPdfVisiblePageRange,
  isPdfLayoutVisible,
  isPdfPageVisible,
  PDF_PAGE_RENDER_MARGIN,
  type PdfLayout,
} from './layout';
import {
  PdfPageRenderScheduler,
  type PdfPageSurface,
} from './render-scheduler';
import {
  clearPdfTextLayerHighlight,
  highlightPdfTextLayer,
} from './text-layer';

const FAST_SCROLL_PX_PER_FRAME = 24;
const logger = new Logger('PdfPageView');

/** One canvas-search occurrence, addressed by layout position and its ordinal on that page. */
export interface PdfSearchHighlight {
  position: number;
  query: string;
  current: number;
}

export interface PdfTextLayerOptions {
  selectable: boolean;
  highlight: PdfSearchHighlight | null;
}

interface PdfTextLayerDom {
  div: HTMLDivElement;
  pageIndex: number;
  ready: boolean;
  // Identifies the marks applied to `div`; '' when there are none.
  highlightKey: string;
}

interface PdfPageDom extends PdfPageSurface {
  root: HTMLDivElement;
  textLayer: PdfTextLayerDom | null;
}

export class PdfPageView {
  private readonly scheduler: PdfPageRenderScheduler;
  private pageDoms = new Map<number, PdfPageDom>();
  private lastScreenOffset: { x: number; y: number } | null = null;
  private readonly onTextLayerRendered: () => void;

  public constructor(params: {
    onTextLayerRendered: () => void;
    onRenderError: (params: {
      error: unknown;
      pageIndex: number;
      pageWidth: number;
      pageHeight: number;
      renderScale: number;
    }) => void;
  }) {
    this.onTextLayerRendered = params.onTextLayerRendered;
    this.scheduler = new PdfPageRenderScheduler({
      onError: ({ error, pageIndex, pageSize, renderScale }) => {
        params.onRenderError({
          error,
          pageIndex,
          pageWidth: pageSize.w,
          pageHeight: pageSize.h,
          renderScale,
        });
      },
    });
  }

  public sync(params: {
    contentRoot: HTMLDivElement | null;
    document: PDFDocumentProxy | null;
    viewport: CanvasViewport;
    zoom: number;
    rasterZoom: number;
    offset: { x: number; y: number };
    scaleX: number;
    scaleY: number;
    pageLayout: PageLayout;
    layout: PdfLayout;
    /** Null leaves pages without a text layer. */
    textLayer: PdfTextLayerOptions | null;
  }): void {
    if (!params.contentRoot) {
      return;
    }
    const worldRect = params.viewport.getWorldRect();
    const screenOffset = {
      x: params.viewport.offset.x * params.zoom,
      y: params.viewport.offset.y * params.zoom,
    };
    const previousScreenOffset = this.lastScreenOffset;
    this.lastScreenOffset = screenOffset;
    const fastScroll =
      previousScreenOffset !== null &&
      Math.max(
        Math.abs(screenOffset.x - previousScreenOffset.x),
        Math.abs(screenOffset.y - previousScreenOffset.y),
      ) > FAST_SCROLL_PX_PER_FRAME;

    if (
      !isPdfLayoutVisible({
        worldRect,
        offset: params.offset,
        scaleX: params.scaleX,
        scaleY: params.scaleY,
        layout: params.layout,
      })
    ) {
      this.removeInactivePageDoms(new Set(), params.document);
      return;
    }

    const visibleRange = getPdfVisiblePageRange({
      worldRect,
      offset: params.offset,
      scaleX: params.scaleX,
      scaleY: params.scaleY,
      margin: PDF_PAGE_RENDER_MARGIN,
      pageLayout: params.pageLayout,
      layout: params.layout,
    });
    const retainMargin =
      PDF_PAGE_RENDER_MARGIN +
      (params.pageLayout === 'horizontal' ? worldRect.width : worldRect.height);
    const retainRange = getPdfVisiblePageRange({
      worldRect,
      offset: params.offset,
      scaleX: params.scaleX,
      scaleY: params.scaleY,
      margin: retainMargin,
      pageLayout: params.pageLayout,
      layout: params.layout,
    });
    const activePagePositions = new Set<number>();
    const dpr = window.devicePixelRatio || 1;

    for (
      let pagePosition = retainRange.start;
      pagePosition < retainRange.end;
      pagePosition++
    ) {
      const page = params.layout.pages[pagePosition];
      const visible =
        pagePosition >= visibleRange.start &&
        pagePosition < visibleRange.end &&
        isPdfPageVisible({
          worldRect,
          offset: params.offset,
          localLeft: page.localLeft,
          localTop: page.localTop,
          pageSize: page.size,
          scaleX: params.scaleX,
          scaleY: params.scaleY,
          verticalMargin: PDF_PAGE_RENDER_MARGIN,
        });
      let pageDom = this.pageDoms.get(pagePosition);
      if (!pageDom) {
        if (!visible) {
          continue;
        }
        pageDom = this.createPageDom(params.contentRoot);
        this.pageDoms.set(pagePosition, pageDom);
      }
      activePagePositions.add(pagePosition);
      this.syncPageGeometry(
        pageDom,
        page,
        params.scaleX,
        params.scaleY,
        params.rasterZoom,
      );
      if (!visible) {
        continue;
      }
      if (page.kind === 'pdf') {
        this.scheduler.request({
          surface: pageDom,
          document: params.document,
          pageIndex: page.originalIndex,
          pageSize: page.size,
          renderScale: getPdfRenderScale({
            pageSize: page.size,
            zoom: params.zoom,
            elementScale: Math.max(params.scaleX, params.scaleY),
            dpr,
          }),
          zoom: params.zoom,
          fastScroll,
        });
        this.syncTextLayer(pageDom, {
          position: pagePosition,
          pageIndex: page.originalIndex,
          document: params.document,
          options: params.textLayer,
          scale: params.scaleX * params.rasterZoom,
        });
      } else {
        this.scheduler.release(pageDom, true);
        this.removeTextLayer(pageDom);
      }
    }
    this.removeInactivePageDoms(activePagePositions, params.document);
  }

  public reconcileOrder(
    previousPages: PdfLayout['pages'],
    nextPages: PdfLayout['pages'],
    document: PDFDocumentProxy | null,
  ): void {
    const reusable = new Map<number, PdfPageDom>();
    for (const [position, pageDom] of this.pageDoms) {
      const page = previousPages[position];
      if (page?.kind === 'pdf') {
        reusable.set(page.originalIndex, pageDom);
      }
    }
    const nextPageDoms = new Map<number, PdfPageDom>();
    const reused = new Set<PdfPageDom>();
    for (const [position, page] of nextPages.entries()) {
      if (page.kind !== 'pdf') {
        continue;
      }
      const pageDom = reusable.get(page.originalIndex);
      if (pageDom) {
        nextPageDoms.set(position, pageDom);
        reused.add(pageDom);
      }
    }
    for (const pageDom of this.pageDoms.values()) {
      if (!reused.has(pageDom)) {
        this.disposePageDom(pageDom, document);
      }
    }
    this.pageDoms = nextPageDoms;
  }

  public invalidate(): void {
    for (const pageDom of this.pageDoms.values()) {
      this.scheduler.release(pageDom, true);
    }
  }

  public dispose(document: PDFDocumentProxy | null): void {
    this.scheduler.dispose(this.pageDoms.values());
    for (const pageDom of this.pageDoms.values()) {
      pageDom.root.remove();
    }
    this.pageDoms.clear();
    this.lastScreenOffset = null;
    void document?.loadingTask.destroy();
  }

  private syncPageGeometry(
    pageDom: PdfPageDom,
    page: PdfLayout['pages'][number],
    scaleX: number,
    scaleY: number,
    rasterZoom: number,
  ): void {
    const left = page.localLeft * scaleX * rasterZoom;
    const top = page.localTop * scaleY * rasterZoom;
    const width = page.size.w * scaleX * rasterZoom;
    const height = page.size.h * scaleY * rasterZoom;
    setStyleIfChanged(
      pageDom.root,
      'transform',
      `translate(${left}px, ${top}px)`,
    );
    setStyleIfChanged(pageDom.root, 'width', `${width}px`);
    setStyleIfChanged(pageDom.root, 'height', `${height}px`);
  }

  private syncTextLayer(
    pageDom: PdfPageDom,
    {
      position,
      pageIndex,
      document: pdfDocument,
      options,
      scale,
    }: {
      position: number;
      pageIndex: number;
      document: PDFDocumentProxy | null;
      options: PdfTextLayerOptions | null;
      scale: number;
    },
  ): void {
    if (!options || !pdfDocument) {
      this.removeTextLayer(pageDom);
      return;
    }
    let layer = pageDom.textLayer;
    if (layer?.pageIndex !== pageIndex) {
      this.removeTextLayer(pageDom);
      const div = document.createElement('div');
      div.className = 'textLayer';
      pageDom.root.appendChild(div);
      const created: PdfTextLayerDom = {
        div,
        pageIndex,
        ready: false,
        highlightKey: '',
      };
      layer = created;
      pageDom.textLayer = created;
      renderPdfTextLayer(pdfDocument, pageIndex, div).then(
        () => {
          created.ready = true;
          this.onTextLayerRendered();
        },
        (error: unknown) => {
          if (div.isConnected) {
            logger.error('Failed to render PDF text layer', error, {
              pageIndex,
            });
          }
        },
      );
    }
    setStyleIfChanged(layer.div, '--total-scale-factor', `${scale}`);
    setStyleIfChanged(
      layer.div,
      'pointer-events',
      options.selectable ? 'auto' : 'none',
    );
    if (!layer.ready) {
      return;
    }
    const highlight =
      options.highlight?.position === position ? options.highlight : null;
    const highlightKey = highlight
      ? `${position}\n${highlight.query}\n${highlight.current}`
      : '';
    if (highlightKey === layer.highlightKey) {
      return;
    }
    layer.highlightKey = highlightKey;
    if (highlight) {
      highlightPdfTextLayer(layer.div, highlight.query, highlight.current);
    } else {
      clearPdfTextLayerHighlight(layer.div);
    }
  }

  private removeTextLayer(pageDom: PdfPageDom): void {
    pageDom.textLayer?.div.remove();
    pageDom.textLayer = null;
  }

  private removeInactivePageDoms(
    activePositions: Set<number>,
    document: PDFDocumentProxy | null,
  ): void {
    const livePageIndices = new Set<number>();
    for (const [position, pageDom] of this.pageDoms) {
      if (!activePositions.has(position)) {
        continue;
      }
      const pageIndex =
        pageDom.rendered?.pageIndex ??
        pageDom.rendering?.pageIndex ??
        pageDom.pendingRender?.key.pageIndex;
      if (pageIndex !== undefined) {
        livePageIndices.add(pageIndex);
      }
    }
    for (const [position, pageDom] of this.pageDoms) {
      if (!activePositions.has(position)) {
        this.disposePageDom(pageDom, document, livePageIndices);
        this.pageDoms.delete(position);
      }
    }
  }

  private disposePageDom(
    pageDom: PdfPageDom,
    document: PDFDocumentProxy | null,
    livePageIndices?: Set<number>,
  ): void {
    const cachedPageIndex =
      pageDom.rendered?.pageIndex ?? pageDom.rendering?.pageIndex;
    this.scheduler.release(pageDom, true);
    pageDom.root.remove();
    if (
      document &&
      cachedPageIndex !== undefined &&
      !livePageIndices?.has(cachedPageIndex)
    ) {
      cleanupPdfPage(document, cachedPageIndex);
    }
  }

  private createPageDom(contentRoot: HTMLDivElement): PdfPageDom {
    const root = document.createElement('div');
    Object.assign(root.style, {
      position: 'absolute',
      left: '0px',
      top: '0px',
      transformOrigin: '0 0',
      overflow: 'hidden',
      background: 'var(--bg-card)',
      border: '1px solid var(--border-ghost)',
      boxSizing: 'border-box',
      pointerEvents: 'none',
    } as Partial<CSSStyleDeclaration>);
    root.dataset.pdfPage = 'true';
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    Object.assign(canvas.style, {
      display: 'block',
      width: '100%',
      height: '100%',
      background: 'var(--bg-card)',
      pointerEvents: 'none',
    } as Partial<CSSStyleDeclaration>);
    root.appendChild(canvas);
    contentRoot.appendChild(root);
    return {
      root,
      canvas,
      textLayer: null,
      renderHandle: null,
      rendered: null,
      rendering: null,
      pendingRender: null,
    };
  }
}
