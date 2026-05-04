import type { PDFDocumentProxy } from 'pdfjs-dist';
import type * as Y from 'yjs';
import { Logger } from '@/lib/logger';
import type { CanvasViewport } from '../canvas-viewport';
import type { ChromeMenuItem } from '../chrome-menu';
import {
  createDefaultPdfPageOrder,
  getPdfDocumentPageSizes,
  getPdfRenderScale,
  isPdfRenderCancelled,
  normalizePdfPageOrder,
  normalizePdfPageSizes,
  openPdfDocument,
  type PdfPageOrderEntry,
  type PdfPageRenderHandle,
  type PdfPageSize,
  renderPdfPageToCanvas,
} from '../pdf-renderer';
import { DrawableElement, ResizeHandles } from './drawable-element';
import { ElementType } from './element-type';
import {
  CHROME_BOTTOM_PADDING,
  CHROME_HEADER_HEIGHT,
  CHROME_SIDE_PADDING,
  FrameChrome,
} from './frame-chrome';
import { PAGE_GAP, PAGE_HEIGHT, PAGE_WIDTH } from './page-frame-constants';

const logger = new Logger('PdfElement');
const DEFAULT_PAGE_SIZE: PdfPageSize = { w: PAGE_WIDTH, h: PAGE_HEIGHT };
const PAGE_RENDER_MARGIN = PAGE_GAP * 2;

interface PdfPageDom {
  root: HTMLDivElement;
  canvas: HTMLCanvasElement;
  renderHandle: PdfPageRenderHandle | null;
  renderedPageIndex: number | null;
  renderedScale: number | null;
  renderingPageIndex: number | null;
  renderingScale: number | null;
}

interface PdfLayout {
  entries: PdfPageOrderEntry[];
  pageTops: number[];
  totalWidth: number;
  totalHeight: number;
}

function snapToDevicePixel(value: number): number {
  const dpr = window.devicePixelRatio || 1;
  return Math.round(value * dpr) / dpr;
}

function cloneBytes(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(bytes);
}

function clonePageSizes(pageSizes: PdfPageSize[]): PdfPageSize[] {
  return pageSizes.map((size) => ({ w: size.w, h: size.h }));
}

function clonePageOrder(pageOrder: PdfPageOrderEntry[]): PdfPageOrderEntry[] {
  return pageOrder.map((entry) => ({
    kind: entry.kind,
    originalIndex: entry.originalIndex,
  }));
}

function arePageSizesEqual(left: PdfPageSize[], right: PdfPageSize[]): boolean {
  return (
    left.length === right.length &&
    left.every((size, i) => size.w === right[i].w && size.h === right[i].h)
  );
}

function arePageOrdersEqual(
  left: PdfPageOrderEntry[],
  right: PdfPageOrderEntry[],
): boolean {
  return (
    left.length === right.length &&
    left.every((entry, i) => entry.originalIndex === right[i].originalIndex)
  );
}

function getPositiveScale(value: number): number {
  return Math.max(Math.abs(value), 0.001);
}

function isDefaultPageSize(size: PdfPageSize): boolean {
  return size.w === DEFAULT_PAGE_SIZE.w && size.h === DEFAULT_PAGE_SIZE.h;
}

export class PdfElement extends DrawableElement {
  private _pdfBytes: Uint8Array | null = null;
  private _fileName: string = '';
  private _pageSizes: PdfPageSize[] = [DEFAULT_PAGE_SIZE];
  private _pageOrder: PdfPageOrderEntry[] = createDefaultPdfPageOrder(1);
  private _pdfDocument: PDFDocumentProxy | null = null;
  private _chrome: FrameChrome | null = null;
  private _contentRoot: HTMLDivElement | null = null;
  private _pageDoms = new Map<number, PdfPageDom>();
  private _layout: PdfLayout | null = null;
  private _loadGeneration = 0;

  constructor(index: number) {
    super(index, ElementType.PDF);
  }

  public override get resizeHandles(): ResizeHandles {
    return ResizeHandles.Corners;
  }

  public override get maintainAspectRatio(): boolean {
    return true;
  }

  public override getYMapProps(): Record<string, unknown> {
    const props: Record<string, unknown> = {
      fileName: this._fileName,
      pageSizes: clonePageSizes(this._pageSizes),
      pageOrder: clonePageOrder(this.pageEntries),
    };

    if (this._pdfBytes) {
      props.pdfData = cloneBytes(this._pdfBytes);
    }

    return props;
  }

  public override bindToYMap(yMap: Y.Map<unknown>): void {
    super.bindToYMap(yMap);
    this.bindYFields(yMap, {
      pageSizes: (v) => {
        this.setPageSizes(normalizePdfPageSizes(v), false);
      },
      pageOrder: (v) => {
        this._pageOrder = normalizePdfPageOrder(v, this._pageSizes.length);
        this._layout = null;
        this.invalidatePageRenders();
      },
      pdfData: (v) => {
        const isReplacingPdf = this._pdfBytes !== null;
        this._pdfBytes = cloneBytes(v as Uint8Array);
        void this.loadPdfBytes(this._pdfBytes, true, isReplacingPdf);
      },
      fileName: (v) => {
        this._fileName = (v as string) ?? '';
        this._chrome?.setFileName(this._fileName || null);
      },
    });
  }

  public setInitialPdfData(
    bytes: Uint8Array,
    fileName: string,
    pageSizes: PdfPageSize[] = [DEFAULT_PAGE_SIZE],
  ): void {
    this._pdfBytes = cloneBytes(bytes);
    this._fileName = fileName;
    this._chrome?.setFileName(fileName || null);
    this.setPageSizes(pageSizes, false);

    this.syncToYMap({
      pdfData: cloneBytes(this._pdfBytes),
      pageSizes: clonePageSizes(this._pageSizes),
      pageOrder: clonePageOrder(this.pageEntries),
      fileName,
    });

    void this.loadPdfBytes(this._pdfBytes, false, false);
  }

  public get fileName(): string {
    return this._fileName;
  }

  public getMenuItems(): ChromeMenuItem[] {
    return [];
  }

  public get totalWidth(): number {
    return this.getLayout().totalWidth;
  }

  public get totalHeight(): number {
    return this.getLayout().totalHeight;
  }

  public get localBoundingBox(): DOMRect {
    return new DOMRect(
      -CHROME_SIDE_PADDING,
      -CHROME_HEADER_HEIGHT,
      this.totalWidth + CHROME_SIDE_PADDING * 2,
      this.totalHeight + CHROME_HEADER_HEIGHT + CHROME_BOTTOM_PADDING,
    );
  }

  /**
   * Content scales with `_scale`; chrome padding is fixed world units. Override
   * so selection outline + handles track the visible chrome.
   */
  public override get boundingBox(): DOMRect {
    const sX = this._scale.x;
    const sY = this._scale.y;
    const contentW = this.totalWidth * sX;
    const contentH = this.totalHeight * sY;
    return new DOMRect(
      this.offset.x - CHROME_SIDE_PADDING,
      this.offset.y - CHROME_HEADER_HEIGHT,
      contentW + CHROME_SIDE_PADDING * 2,
      contentH + CHROME_HEADER_HEIGHT + CHROME_BOTTOM_PADDING,
    );
  }

  protected isOverLocal(
    x: number,
    y: number,
    _radius: number,
    _ctx: CanvasRenderingContext2D,
  ): boolean {
    return (
      x >= -CHROME_SIDE_PADDING &&
      x <= this.totalWidth + CHROME_SIDE_PADDING &&
      y >= -CHROME_HEADER_HEIGHT &&
      y <= this.totalHeight + CHROME_BOTTOM_PADDING
    );
  }

  protected updateBoundingBox(): void {}

  protected draw2D(_ctx: CanvasRenderingContext2D, _deltaTime: number): void {}

  public override syncDOM(viewport: CanvasViewport, host: HTMLElement): void {
    if (!this._chrome) {
      this.createDom(host);
    }

    const zoom = viewport.zoom;
    const offset = viewport.offset;
    const scaleX = getPositiveScale(this._scale.x);
    const scaleY = getPositiveScale(this._scale.y);
    const layout = this.getLayout();
    const contentWidth = layout.totalWidth * scaleX;
    const contentHeight = layout.totalHeight * scaleY;
    const screenX = snapToDevicePixel((this.offset.x + offset.x) * zoom);
    const screenY = snapToDevicePixel((this.offset.y + offset.y) * zoom);

    this._chrome?.sync({
      screenX,
      screenY,
      contentWidth,
      contentHeight,
      zoom,
    });

    this.syncContentRoot(contentWidth, contentHeight, zoom);
    this.syncPageDoms(viewport, zoom, scaleX, scaleY, layout);
  }

  public override disposeDOM(): void {
    super.disposeDOM();
    this._loadGeneration++;
    this.cancelPageRenders();
    void this._pdfDocument?.destroy();
    this._pdfDocument = null;
    this._pageDoms.clear();
    this._contentRoot = null;
    this._chrome?.dispose();
    this._chrome = null;
  }

  private get pageEntries(): PdfPageOrderEntry[] {
    return this.getLayout().entries;
  }

  private getPageSize(entry: PdfPageOrderEntry): PdfPageSize {
    return this._pageSizes[entry.originalIndex] ?? DEFAULT_PAGE_SIZE;
  }

  private getLayout(): PdfLayout {
    if (this._layout) {
      return this._layout;
    }

    const entries = normalizePdfPageOrder(
      this._pageOrder,
      this._pageSizes.length,
    );
    const pageTops: number[] = [];
    let totalWidth = 0;
    let totalHeight = 0;

    for (let i = 0; i < entries.length; i++) {
      if (i > 0) {
        totalHeight += PAGE_GAP;
      }
      pageTops.push(totalHeight);
      const pageSize = this.getPageSize(entries[i]);
      totalWidth = Math.max(totalWidth, pageSize.w);
      totalHeight += pageSize.h;
    }

    this._layout = { entries, pageTops, totalWidth, totalHeight };
    return this._layout;
  }

  private setPageSizes(pageSizes: PdfPageSize[], sync: boolean): void {
    const nextPageSizes =
      pageSizes.length > 0 ? pageSizes : [DEFAULT_PAGE_SIZE];
    const nextPageOrder = normalizePdfPageOrder(
      this._pageOrder,
      nextPageSizes.length,
    );
    const shouldSync =
      sync && this.shouldSyncPageMetadata(nextPageSizes, nextPageOrder);

    this._pageSizes = clonePageSizes(nextPageSizes);
    this._pageOrder = clonePageOrder(nextPageOrder);
    this._layout = null;
    this.invalidatePageRenders();

    if (shouldSync) {
      this.syncToYMap({
        pageSizes: clonePageSizes(this._pageSizes),
        pageOrder: clonePageOrder(this.pageEntries),
      });
    }
  }

  private shouldSyncPageMetadata(
    pageSizes: PdfPageSize[],
    pageOrder: PdfPageOrderEntry[],
  ): boolean {
    if (!this._yMap) {
      return false;
    }

    if (!this._yMap.has('pageSizes') || !this._yMap.has('pageOrder')) {
      return true;
    }

    return (
      !arePageSizesEqual(
        normalizePdfPageSizes(this._yMap.get('pageSizes')),
        pageSizes,
      ) ||
      !arePageOrdersEqual(
        normalizePdfPageOrder(this._yMap.get('pageOrder'), pageSizes.length),
        pageOrder,
      )
    );
  }

  private shouldLoadPageMetadata(pageCount: number): boolean {
    if (!this._yMap?.has('pageSizes') || !this._yMap.has('pageOrder')) {
      return true;
    }

    if (this._pageSizes.length !== pageCount) {
      return true;
    }

    const pageOrder = normalizePdfPageOrder(this._pageOrder, pageCount);
    return (
      !arePageOrdersEqual(this._pageOrder, pageOrder) ||
      (pageCount === 1 &&
        this._pageSizes.length === 1 &&
        isDefaultPageSize(this._pageSizes[0]))
    );
  }

  private async loadPdfBytes(
    bytes: Uint8Array,
    syncMetadata: boolean,
    forceMetadata: boolean,
  ): Promise<void> {
    const generation = ++this._loadGeneration;
    this.invalidatePageRenders();
    void this._pdfDocument?.destroy();
    this._pdfDocument = null;

    try {
      const document = await openPdfDocument(bytes);
      if (generation !== this._loadGeneration) {
        await document.destroy();
        return;
      }

      this._pdfDocument = document;

      if (!forceMetadata && !this.shouldLoadPageMetadata(document.numPages)) {
        return;
      }

      const pageSizes = await getPdfDocumentPageSizes(document);
      if (generation !== this._loadGeneration) {
        return;
      }

      this.setPageSizes(pageSizes, syncMetadata);
    } catch (error) {
      if (generation !== this._loadGeneration) {
        return;
      }
      logger.error('Failed to load PDF', error, {
        index: this.index,
        fileName: this._fileName,
      });
    }
  }

  private invalidatePageRenders(): void {
    for (const pageDom of this._pageDoms.values()) {
      this.releasePageRender(pageDom, true);
    }
  }

  private cancelPageRenders(): void {
    for (const pageDom of this._pageDoms.values()) {
      this.releasePageRender(pageDom, false);
    }
  }

  private disposePageDom(pageDom: PdfPageDom): void {
    this.releasePageRender(pageDom, true);
    pageDom.root.remove();
  }

  private releasePageRender(
    pageDom: PdfPageDom,
    clearRenderedCanvas: boolean,
  ): void {
    pageDom.renderHandle?.cancel();
    pageDom.renderHandle = null;
    pageDom.renderingPageIndex = null;
    pageDom.renderingScale = null;

    if (!clearRenderedCanvas) {
      return;
    }

    pageDom.renderedPageIndex = null;
    pageDom.renderedScale = null;
    if (pageDom.canvas.width !== 1 || pageDom.canvas.height !== 1) {
      pageDom.canvas.width = 1;
      pageDom.canvas.height = 1;
    }
  }

  private syncContentRoot(
    contentWidth: number,
    contentHeight: number,
    zoom: number,
  ): void {
    if (!this._contentRoot) {
      return;
    }

    this._contentRoot.style.width = `${contentWidth * zoom}px`;
    this._contentRoot.style.height = `${contentHeight * zoom}px`;
  }

  private syncPageDoms(
    viewport: CanvasViewport,
    zoom: number,
    scaleX: number,
    scaleY: number,
    layout: PdfLayout,
  ): void {
    const contentRoot = this._contentRoot;
    if (!contentRoot) {
      return;
    }

    const worldRect = viewport.getWorldRect();
    const dpr = window.devicePixelRatio || 1;
    const activePageDomIndexes = new Set<number>();

    if (!this.isLayoutHorizontallyVisible(worldRect, layout, scaleX)) {
      this.removeInactivePageDoms(activePageDomIndexes);
      return;
    }

    const visibleRange = this.getVisiblePageRange(worldRect, layout, scaleY);
    for (let i = visibleRange.start; i < visibleRange.end; i++) {
      const entry = layout.entries[i];
      const pageSize = this.getPageSize(entry);
      const localTop = layout.pageTops[i];
      const localLeft = (layout.totalWidth - pageSize.w) / 2;

      if (
        !this.isPageVisible(
          worldRect,
          localLeft,
          localTop,
          pageSize,
          scaleX,
          scaleY,
        )
      ) {
        continue;
      }

      let pageDom = this._pageDoms.get(i);
      if (!pageDom) {
        pageDom = this.createPageDom(contentRoot);
        this._pageDoms.set(i, pageDom);
      }
      activePageDomIndexes.add(i);

      const cssLeft = localLeft * scaleX * zoom;
      const cssTop = localTop * scaleY * zoom;
      const cssWidth = pageSize.w * scaleX * zoom;
      const cssHeight = pageSize.h * scaleY * zoom;

      pageDom.root.style.transform = `translate(${cssLeft}px, ${cssTop}px)`;
      pageDom.root.style.width = `${cssWidth}px`;
      pageDom.root.style.height = `${cssHeight}px`;

      const renderScale = getPdfRenderScale({
        pageSize,
        zoom,
        elementScale: Math.max(scaleX, scaleY),
        dpr,
      });
      this.requestPageRender(
        pageDom,
        entry.originalIndex,
        pageSize,
        renderScale,
      );
    }

    this.removeInactivePageDoms(activePageDomIndexes);
  }

  private removeInactivePageDoms(activePageDomIndexes: Set<number>): void {
    for (const [index, pageDom] of this._pageDoms) {
      if (!activePageDomIndexes.has(index)) {
        this.disposePageDom(pageDom);
        this._pageDoms.delete(index);
      }
    }
  }

  private isLayoutHorizontallyVisible(
    worldRect: DOMRect,
    layout: PdfLayout,
    scaleX: number,
  ): boolean {
    const left = this.offset.x;
    const right = left + layout.totalWidth * scaleX;
    return right >= worldRect.left && left <= worldRect.right;
  }

  private getVisiblePageRange(
    worldRect: DOMRect,
    layout: PdfLayout,
    scaleY: number,
  ): { start: number; end: number } {
    const localTop =
      (worldRect.top - PAGE_RENDER_MARGIN - this.offset.y) / scaleY;
    const localBottom =
      (worldRect.bottom + PAGE_RENDER_MARGIN - this.offset.y) / scaleY;

    return {
      start: this.findFirstPageEndingAtOrAfter(layout, localTop),
      end: this.findFirstPageStartingAfter(layout, localBottom),
    };
  }

  private findFirstPageEndingAtOrAfter(
    layout: PdfLayout,
    localY: number,
  ): number {
    let low = 0;
    let high = layout.entries.length;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      const pageBottom =
        layout.pageTops[mid] + this.getPageSize(layout.entries[mid]).h;
      if (pageBottom < localY) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }
    return low;
  }

  private findFirstPageStartingAfter(
    layout: PdfLayout,
    localY: number,
  ): number {
    let low = 0;
    let high = layout.pageTops.length;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (layout.pageTops[mid] <= localY) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }
    return low;
  }

  private isPageVisible(
    worldRect: DOMRect,
    localLeft: number,
    localTop: number,
    pageSize: PdfPageSize,
    scaleX: number,
    scaleY: number,
  ): boolean {
    const pageLeft = this.offset.x + localLeft * scaleX;
    const pageTop = this.offset.y + localTop * scaleY;
    const pageRight = pageLeft + pageSize.w * scaleX;
    const pageBottom = pageTop + pageSize.h * scaleY;

    return (
      pageRight >= worldRect.left &&
      pageLeft <= worldRect.right &&
      pageBottom >= worldRect.top - PAGE_RENDER_MARGIN &&
      pageTop <= worldRect.bottom + PAGE_RENDER_MARGIN
    );
  }

  private requestPageRender(
    pageDom: PdfPageDom,
    pageIndex: number,
    pageSize: PdfPageSize,
    renderScale: number,
  ): void {
    const document = this._pdfDocument;
    if (!document) {
      return;
    }

    if (
      pageDom.renderedPageIndex === pageIndex &&
      pageDom.renderedScale === renderScale
    ) {
      return;
    }

    if (
      pageDom.renderingPageIndex === pageIndex &&
      pageDom.renderingScale === renderScale
    ) {
      return;
    }

    pageDom.renderHandle?.cancel();
    pageDom.renderingPageIndex = pageIndex;
    pageDom.renderingScale = renderScale;

    const handle = renderPdfPageToCanvas({
      document,
      pageIndex,
      canvas: pageDom.canvas,
      renderScale,
    });
    pageDom.renderHandle = handle;

    void handle.promise
      .then(() => {
        if (pageDom.renderHandle !== handle) {
          return;
        }
        pageDom.renderHandle = null;
        pageDom.renderedPageIndex = pageIndex;
        pageDom.renderedScale = renderScale;
        pageDom.renderingPageIndex = null;
        pageDom.renderingScale = null;
      })
      .catch((error) => {
        if (isPdfRenderCancelled(error) || pageDom.renderHandle !== handle) {
          return;
        }
        pageDom.renderHandle = null;
        pageDom.renderingPageIndex = null;
        pageDom.renderingScale = null;
        logger.error('Failed to render PDF page', error, {
          index: this.index,
          fileName: this._fileName,
          pageIndex,
          pageWidth: pageSize.w,
          pageHeight: pageSize.h,
          renderScale,
        });
      });
  }

  private createDom(host: HTMLElement): void {
    const chrome = new FrameChrome({
      kindLabel: 'PDF',
      getMenuItems: () => this.getMenuItems(),
    });
    chrome.setFileName(this._fileName || null);
    chrome.root.dataset.elementIndex = String(this.index);
    chrome.root.dataset.elementType = 'pdf';

    const contentRoot = document.createElement('div');
    Object.assign(contentRoot.style, {
      position: 'absolute',
      left: '0px',
      top: '0px',
      transformOrigin: '0 0',
      overflow: 'hidden',
      pointerEvents: 'none',
    } as Partial<CSSStyleDeclaration>);
    contentRoot.dataset.pdfContent = 'true';

    chrome.contentSlot.appendChild(contentRoot);
    host.appendChild(chrome.root);
    this._chrome = chrome;
    this._contentRoot = contentRoot;
  }

  private createPageDom(contentRoot: HTMLDivElement): PdfPageDom {
    const root = document.createElement('div');
    Object.assign(root.style, {
      position: 'absolute',
      left: '0px',
      top: '0px',
      transformOrigin: '0 0',
      overflow: 'hidden',
      background: '#ffffff',
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
      background: '#ffffff',
      pointerEvents: 'none',
    } as Partial<CSSStyleDeclaration>);

    root.appendChild(canvas);
    contentRoot.appendChild(root);

    return {
      root,
      canvas,
      renderHandle: null,
      renderedPageIndex: null,
      renderedScale: null,
      renderingPageIndex: null,
      renderingScale: null,
    };
  }
}
