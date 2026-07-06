import {
  Columns3 as ColumnsIcon,
  Download as DownloadIcon,
  Rows3 as RowsIcon,
} from 'lucide-react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type * as Y from 'yjs';
import { getMessages } from '@/lib/i18n';
import { Logger } from '@/lib/logger';
import { bytesToBase64 } from '@/lib/pdf-export/contract';
import { getPlatform } from '@/platform';
import { CanvasPool } from '../canvas-pool';
import type { CanvasViewport } from '../canvas-viewport';
import type { ChromeMenuItem } from '../chrome-menu';
import {
  type ExportOptions,
  type ExportResult,
  type ExportTarget,
  openExportDialog,
} from '../export/export-controller';
import {
  buildPdfElementRequest,
  type PdfElementExportPage,
  type PdfElementExportPdfPage,
  type PdfElementExportSource,
  prepareExportOverlays,
} from '../pdf-element-export';
import {
  cleanupPdfPage,
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
  getFrameChromeControlsLayer,
} from './frame/chrome';
import {
  PAGE_GAP,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  type PageLayout,
} from './page-frame-constants';
import {
  createPdfChromeButton,
  type PdfChromeButtonHandle,
} from './pdf-chrome-button';

const logger = new Logger('PdfElement');
const DEFAULT_PAGE_SIZE: PdfPageSize = { w: PAGE_WIDTH, h: PAGE_HEIGHT };
const PAGE_RENDER_MARGIN = PAGE_GAP * 2;
const PDF_RENDER_DEBOUNCE_MS = 120;
// Screen-px viewport movement per sync frame above which a scroll counts as
// "fast": first renders of newly visible pages are debounced instead of
// started immediately, so a fling doesn't queue a worker render per page.
const FAST_SCROLL_PX_PER_FRAME = 24;
// Staging canvases kept (at size) between renders to avoid reallocating a
// page-sized backing store for every render.
const STAGING_CANVAS_POOL_SIZE = 2;
const GAP_BUTTON_SIZE = 24;
const DELETE_BUTTON_SIZE = 24;
const DELETE_BUTTON_OFFSET = 16;
const MIN_CHROME_BUTTON_PIXEL_SIZE = 18;

interface PdfPageDom {
  root: HTMLDivElement;
  canvas: HTMLCanvasElement;
  renderHandle: PdfPageRenderHandle | null;
  rendered: PdfPageRenderKey | null;
  rendering: PdfPageRenderKey | null;
  pendingRender: PendingPdfPageRender | null;
}

interface PdfPageRenderKey {
  pageIndex: number;
  renderScale: number;
}

interface PendingPdfPageRender {
  key: PdfPageRenderKey;
  timeout: number;
  zoom: number;
}

interface PdfLayout {
  pages: PdfElementExportPage[];
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
  return pageOrder.map((entry) =>
    entry.kind === 'pdf'
      ? { kind: 'pdf', originalIndex: entry.originalIndex }
      : { kind: 'blank', size: { ...entry.size } },
  );
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
    left.every((entry, i) => {
      const other = right[i];
      if (entry.kind !== other.kind) {
        return false;
      }
      if (entry.kind === 'pdf' && other.kind === 'pdf') {
        return entry.originalIndex === other.originalIndex;
      }
      if (entry.kind === 'blank' && other.kind === 'blank') {
        return entry.size.w === other.size.w && entry.size.h === other.size.h;
      }
      return false;
    })
  );
}

function getPositiveScale(value: number): number {
  return Math.max(Math.abs(value), 0.001);
}

function isDefaultPageSize(size: PdfPageSize): boolean {
  return size.w === DEFAULT_PAGE_SIZE.w && size.h === DEFAULT_PAGE_SIZE.h;
}

function isSameRenderKey(
  left: PdfPageRenderKey | null,
  right: PdfPageRenderKey,
): boolean {
  return (
    left !== null &&
    left.pageIndex === right.pageIndex &&
    left.renderScale === right.renderScale
  );
}

export class PdfElement extends DrawableElement {
  private _pdfBytes: Uint8Array | null = null;
  private _fileName: string = '';
  private _pageSizes: PdfPageSize[] = [DEFAULT_PAGE_SIZE];
  private _pageOrder: PdfPageOrderEntry[] = createDefaultPdfPageOrder(1);
  private _pageLayout: PageLayout;
  private _pdfDocument: PDFDocumentProxy | null = null;
  private _chrome: FrameChrome | null = null;
  private _contentRoot: HTMLDivElement | null = null;
  private _pageDoms = new Map<number, PdfPageDom>();
  private _gapButtons = new Map<number, PdfChromeButtonHandle>();
  private _deleteButtons = new Map<number, PdfChromeButtonHandle>();
  private _layout: PdfLayout | null = null;
  private _loadGeneration = 0;
  private _exportElementsProvider: (() => readonly DrawableElement[]) | null =
    null;
  private _pageOrderCustom = false;
  private _stagingCanvasPool = new CanvasPool(STAGING_CANVAS_POOL_SIZE);
  private _lastSyncScreenOffset: { x: number; y: number } | null = null;
  private _thumbnailPages: {
    canvas: HTMLCanvasElement;
    page: PdfElementExportPdfPage;
  }[] = [];
  private _pdfLoadPromise: Promise<void> | null = null;

  constructor(uuid: string, pageLayout: PageLayout = 'vertical') {
    super(uuid, ElementType.PDF);
    // A PDF is inherently paginated, so the page-frame-only `continuous` layout
    // doesn't apply: fall back to vertical pages.
    this._pageLayout = pageLayout === 'horizontal' ? 'horizontal' : 'vertical';
  }

  public setExportElementsProvider(
    provider: () => readonly DrawableElement[],
  ): void {
    this._exportElementsProvider = provider;
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
      pageLayout: this._pageLayout,
    };

    if (this._pageOrderCustom) {
      props.pageOrderCustom = true;
    }

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
      pageOrderCustom: (v) => {
        this._pageOrderCustom = v === true;
      },
      pageOrder: (v) => {
        const allowMissing =
          this._pageOrderCustom || yMap.get('pageOrderCustom') === true;
        if (allowMissing) {
          this._pageOrderCustom = true;
        }
        this.applyPageOrder(this.normalizePageOrder(v, allowMissing));
      },
      pageLayout: (v) => {
        const next: PageLayout = v === 'horizontal' ? 'horizontal' : 'vertical';
        if (next !== this._pageLayout) {
          this._pageLayout = next;
          this._layout = null;
          this.removeAllGapButtons();
          this.removeAllDeleteButtons();
        }
      },
      pdfData: (v) => {
        const isReplacingPdf = this._pdfBytes !== null;
        this._pdfBytes = cloneBytes(v as Uint8Array);
        this._pdfLoadPromise = this.loadPdfBytes(
          this._pdfBytes,
          true,
          isReplacingPdf,
        );
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

    this._pdfLoadPromise = this.loadPdfBytes(this._pdfBytes, false, false);
  }

  public get fileName(): string {
    return this._fileName;
  }

  public get pageLayout(): PageLayout {
    return this._pageLayout;
  }

  public setPageLayout(pageLayout: PageLayout): void {
    if (pageLayout === this._pageLayout) {
      return;
    }
    this._pageLayout = pageLayout;
    this._layout = null;
    this.removeAllGapButtons();
    this.removeAllDeleteButtons();
    this.syncToYMap({ pageLayout });
  }

  public getMenuItems(): ChromeMenuItem[] {
    if (!this._pdfBytes) {
      return [];
    }

    const strings = getMessages().canvas.frame;
    return [
      {
        id: 'layout-vertical',
        label: strings.pages,
        icon: RowsIcon,
        checked: this._pageLayout === 'vertical',
        onSelect: () => this.setPageLayout('vertical'),
      },
      {
        id: 'layout-horizontal',
        label: strings.columns,
        icon: ColumnsIcon,
        checked: this._pageLayout === 'horizontal',
        onSelect: () => this.setPageLayout('horizontal'),
      },
      // PDF is this element's only export format, so the entry itself is
      // gated on the capability.
      ...(getPlatform().pdfExport
        ? [
            {
              id: 'export',
              label: strings.export,
              icon: DownloadIcon,
              onSelect: () => openExportDialog(this.buildExportTarget()),
            },
          ]
        : []),
    ];
  }

  private buildExportTarget(): ExportTarget {
    return {
      title: this._fileName || 'PDF',
      formats: ['pdf'],
      supportsAnnotations: true,
      run: (options) => this.runExport(options),
    };
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

  /**
   * Render the pages visible in the capture region into cached offscreen
   * canvases so the thumbnail can blit them. Uses dedicated canvases (not the
   * on-screen staging pool) so thumbnail rendering never evicts or contends
   * with live page renders.
   */
  public override async prepareThumbnail(
    scale: number,
    region: DOMRect,
  ): Promise<void> {
    this._thumbnailPages = [];

    // The capture can fire before the PDF bytes finish opening; wait for the
    // in-flight load instead of producing a blank thumbnail.
    await this._pdfLoadPromise;

    const pdfDocument = this._pdfDocument;
    if (!pdfDocument) {
      return;
    }

    const scaleX = getPositiveScale(this._scale.x);
    const scaleY = getPositiveScale(this._scale.y);

    for (const page of this.getLayout().pages) {
      if (
        page.kind !== 'pdf' ||
        !this.isPageVisible(
          region,
          page.localLeft,
          page.localTop,
          page.size,
          scaleX,
          scaleY,
        )
      ) {
        continue;
      }

      // The thumbnail context is scaled by `scale`, which plays the role the
      // viewport zoom plays for the live render.
      const renderScale = getPdfRenderScale({
        pageSize: page.size,
        zoom: scale,
        elementScale: Math.max(scaleX, scaleY),
        dpr: 1,
      });

      const canvas = document.createElement('canvas');
      try {
        await renderPdfPageToCanvas({
          document: pdfDocument,
          pageIndex: page.originalIndex,
          canvas,
          renderScale,
        }).promise;
      } catch (error) {
        if (!isPdfRenderCancelled(error)) {
          logger.error('Failed to render PDF thumbnail page', error, {
            uuid: this.uuid,
            fileName: this._fileName,
            pageIndex: page.originalIndex,
          });
        }
        continue;
      }

      this._thumbnailPages.push({ canvas, page });
    }
  }

  public override drawThumbnail(
    ctx: CanvasRenderingContext2D,
    _deltaTime: number,
  ): void {
    for (const { canvas, page } of this._thumbnailPages) {
      ctx.drawImage(
        canvas,
        page.localLeft,
        page.localTop,
        page.size.w,
        page.size.h,
      );
    }
  }

  private async runExport({
    includeAnnotations,
  }: ExportOptions): Promise<ExportResult> {
    const pdfExport = getPlatform().pdfExport;
    if (!pdfExport) {
      return { cancelled: true };
    }
    const source = this.getPdfExportSource();
    if (!source) {
      return {};
    }
    const outcome = await pdfExport.export({
      suggestedName: this.getDefaultExportFileName(),
      buildRequest: async () => {
        const overlays = includeAnnotations
          ? (this._exportElementsProvider?.() ?? [])
          : [];
        await prepareExportOverlays(overlays);
        const request = buildPdfElementRequest(source, overlays);
        request.originalPdfB64 = bytesToBase64(source.pdfBytes);
        return request;
      },
    });
    return outcome.cancelled ? { cancelled: true } : {};
  }

  public getPdfExportSource(): PdfElementExportSource | null {
    if (!this._pdfBytes) {
      return null;
    }

    const layout = this.getLayout();
    return {
      uuid: this.uuid,
      pdfBytes: this._pdfBytes,
      pages: layout.pages,
      offset: { x: this.offset.x, y: this.offset.y },
      scale: {
        x: getPositiveScale(this._scale.x),
        y: getPositiveScale(this._scale.y),
      },
      boundingBox: this.boundingBox,
    };
  }

  private getDefaultExportFileName(): string {
    const trimmed = this._fileName.trim();
    if (!trimmed) {
      return 'document.pdf';
    }
    return trimmed.toLowerCase().endsWith('.pdf') ? trimmed : `${trimmed}.pdf`;
  }

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
    this.syncGapButtons(viewport, zoom, scaleX, scaleY, layout);
    this.syncDeleteButtons(viewport, zoom, scaleX, scaleY, layout);
  }

  public override disposeDOM(): void {
    super.disposeDOM();
    this._loadGeneration++;
    this.cancelPageRenders();
    this._stagingCanvasPool.drain();
    this._thumbnailPages = [];
    this._lastSyncScreenOffset = null;
    void this._pdfDocument?.destroy();
    this._pdfDocument = null;
    this._pageDoms.clear();
    this.removeAllGapButtons();
    this.removeAllDeleteButtons();
    this._contentRoot = null;
    this._chrome?.dispose();
    this._chrome = null;
  }

  private get pageEntries(): PdfPageOrderEntry[] {
    return this.getLayout().pages.map((page) =>
      page.kind === 'pdf'
        ? { kind: 'pdf', originalIndex: page.originalIndex }
        : { kind: 'blank', size: { ...page.size } },
    );
  }

  private getPageSize(entry: PdfPageOrderEntry): PdfPageSize {
    if (entry.kind === 'blank') {
      return entry.size;
    }
    return this._pageSizes[entry.originalIndex] ?? DEFAULT_PAGE_SIZE;
  }

  private normalizePageOrder(
    value: unknown,
    allowMissingPdfPages = this._pageOrderCustom,
  ): PdfPageOrderEntry[] {
    return normalizePdfPageOrder(
      value,
      this._pageSizes.length,
      DEFAULT_PAGE_SIZE,
      allowMissingPdfPages,
    );
  }

  private getLayout(): PdfLayout {
    if (this._layout) {
      return this._layout;
    }

    const entries = this.normalizePageOrder(this._pageOrder);
    const pages: PdfElementExportPage[] = [];
    let totalWidth = 0;
    let totalHeight = 0;

    if (this._pageLayout === 'horizontal') {
      for (const entry of entries) {
        if (pages.length > 0) {
          totalWidth += PAGE_GAP;
        }
        const pageSize = this.getPageSize(entry);
        pages.push(
          entry.kind === 'pdf'
            ? {
                kind: 'pdf',
                originalIndex: entry.originalIndex,
                size: pageSize,
                localLeft: totalWidth,
                localTop: 0,
              }
            : {
                kind: 'blank',
                size: pageSize,
                localLeft: totalWidth,
                localTop: 0,
              },
        );
        totalWidth += pageSize.w;
        totalHeight = Math.max(totalHeight, pageSize.h);
      }

      for (const page of pages) {
        page.localTop = (totalHeight - page.size.h) / 2;
      }
    } else {
      for (const entry of entries) {
        if (pages.length > 0) {
          totalHeight += PAGE_GAP;
        }
        const pageSize = this.getPageSize(entry);
        pages.push(
          entry.kind === 'pdf'
            ? {
                kind: 'pdf',
                originalIndex: entry.originalIndex,
                size: pageSize,
                localLeft: 0,
                localTop: totalHeight,
              }
            : {
                kind: 'blank',
                size: pageSize,
                localLeft: 0,
                localTop: totalHeight,
              },
        );
        totalWidth = Math.max(totalWidth, pageSize.w);
        totalHeight += pageSize.h;
      }

      for (const page of pages) {
        page.localLeft = (totalWidth - page.size.w) / 2;
      }
    }

    this._layout = { pages, totalWidth, totalHeight };
    return this._layout;
  }

  private setPageSizes(pageSizes: PdfPageSize[], sync: boolean): void {
    const nextPageSizes =
      pageSizes.length > 0 ? pageSizes : [DEFAULT_PAGE_SIZE];
    const nextPageOrder = normalizePdfPageOrder(
      this._pageOrder,
      nextPageSizes.length,
      DEFAULT_PAGE_SIZE,
      this._pageOrderCustom,
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
        normalizePdfPageOrder(
          this._yMap.get('pageOrder'),
          pageSizes.length,
          DEFAULT_PAGE_SIZE,
          this._yMap.get('pageOrderCustom') === true,
        ),
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

    const pageOrder = normalizePdfPageOrder(
      this._pageOrder,
      pageCount,
      DEFAULT_PAGE_SIZE,
      this._pageOrderCustom,
    );
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
        uuid: this.uuid,
        fileName: this._fileName,
      });
    }
  }

  private invalidatePageRenders(): void {
    for (const pageDom of this._pageDoms.values()) {
      this.releasePageRender(pageDom, true);
    }
  }

  private applyPageOrder(nextOrder: PdfPageOrderEntry[]): void {
    const previousPages =
      this._pageDoms.size > 0 ? this.getLayout().pages : null;

    this._pageOrder = clonePageOrder(nextOrder);
    this._layout = null;

    if (previousPages) {
      this.reconcilePageDomsAfterOrderChange(
        previousPages,
        this.getLayout().pages,
      );
    }

    this.removeAllGapButtons();
    this.removeAllDeleteButtons();
  }

  private commitCustomPageOrder(nextOrder: PdfPageOrderEntry[]): void {
    this._pageOrderCustom = true;
    this.applyPageOrder(nextOrder);
    this.syncToYMap({
      pageOrder: clonePageOrder(this._pageOrder),
      pageOrderCustom: true,
    });
  }

  private reconcilePageDomsAfterOrderChange(
    previousPages: PdfElementExportPage[],
    nextPages: PdfElementExportPage[],
  ): void {
    const reusablePdfDoms = new Map<number, PdfPageDom>();
    for (const [pagePosition, pageDom] of this._pageDoms) {
      const page = previousPages[pagePosition];
      if (page?.kind === 'pdf') {
        reusablePdfDoms.set(page.originalIndex, pageDom);
      }
    }

    const nextPageDoms = new Map<number, PdfPageDom>();
    const reusedDoms = new Set<PdfPageDom>();
    for (const [pagePosition, page] of nextPages.entries()) {
      if (page.kind !== 'pdf') {
        continue;
      }
      const pageDom = reusablePdfDoms.get(page.originalIndex);
      if (!pageDom) {
        continue;
      }
      nextPageDoms.set(pagePosition, pageDom);
      reusedDoms.add(pageDom);
      reusablePdfDoms.delete(page.originalIndex);
    }

    for (const pageDom of this._pageDoms.values()) {
      if (!reusedDoms.has(pageDom)) {
        this.disposePageDom(pageDom);
      }
    }

    this._pageDoms = nextPageDoms;
  }

  private cancelPageRenders(): void {
    for (const pageDom of this._pageDoms.values()) {
      this.releasePageRender(pageDom, true);
    }
  }

  private disposePageDom(
    pageDom: PdfPageDom,
    livePageIndices?: Set<number>,
  ): void {
    // Renders no longer cleanup() per pass, so release pdf.js's page caches
    // when the page's dom is evicted instead.
    const cachedPageIndex =
      pageDom.rendered?.pageIndex ?? pageDom.rendering?.pageIndex;
    this.releasePageRender(pageDom, true);
    pageDom.root.remove();
    // Skip cleanup when another surviving dom still uses this page index:
    // scroll jitter at the retain edge can evict then immediately re-create a
    // page whose render is rAF/debounce-scheduled, so cleanup() (which only
    // refuses while a render is in flight) would wipe caches the pending
    // render is about to reuse.
    if (
      this._pdfDocument &&
      cachedPageIndex !== undefined &&
      !livePageIndices?.has(cachedPageIndex)
    ) {
      cleanupPdfPage(this._pdfDocument, cachedPageIndex);
    }
  }

  private releasePageRender(
    pageDom: PdfPageDom,
    clearRenderedCanvas: boolean,
  ): void {
    this.clearPendingPageRender(pageDom);
    pageDom.renderHandle?.cancel();
    pageDom.renderHandle = null;
    pageDom.rendering = null;

    if (!clearRenderedCanvas) {
      return;
    }

    pageDom.rendered = null;
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
    const activePagePositions = new Set<number>();

    const screenOffset = {
      x: viewport.offset.x * zoom,
      y: viewport.offset.y * zoom,
    };
    const lastOffset = this._lastSyncScreenOffset;
    this._lastSyncScreenOffset = screenOffset;
    const fastScroll =
      lastOffset !== null &&
      Math.max(
        Math.abs(screenOffset.x - lastOffset.x),
        Math.abs(screenOffset.y - lastOffset.y),
      ) > FAST_SCROLL_PX_PER_FRAME;

    if (!this.isLayoutVisible(worldRect, layout, scaleX, scaleY)) {
      this.removeInactivePageDoms(activePagePositions);
      return;
    }

    const visibleRange = this.getVisiblePageRange(
      worldRect,
      layout,
      scaleX,
      scaleY,
      PAGE_RENDER_MARGIN,
    );
    // Rendered bitmaps within a viewport's reach of the visible range are
    // kept alive instead of evicted, so scrolling back doesn't re-render
    // through the pdf.js worker. The retained count scales with 1/zoom while
    // bitmap size scales with zoom², keeping memory roughly constant.
    const retainMargin =
      PAGE_RENDER_MARGIN +
      (this._pageLayout === 'horizontal' ? worldRect.width : worldRect.height);
    const retainRange = this.getVisiblePageRange(
      worldRect,
      layout,
      scaleX,
      scaleY,
      retainMargin,
    );
    for (
      let pagePosition = retainRange.start;
      pagePosition < retainRange.end;
      pagePosition++
    ) {
      const page = layout.pages[pagePosition];

      const visible =
        pagePosition >= visibleRange.start &&
        pagePosition < visibleRange.end &&
        this.isPageVisible(
          worldRect,
          page.localLeft,
          page.localTop,
          page.size,
          scaleX,
          scaleY,
        );

      let pageDom = this._pageDoms.get(pagePosition);
      if (!pageDom) {
        if (!visible) {
          continue;
        }
        pageDom = this.createPageDom(contentRoot);
        this._pageDoms.set(pagePosition, pageDom);
      }
      activePagePositions.add(pagePosition);

      // Geometry syncs for retained pages too — a stale transform from a
      // previous zoom level could place an off-range dom inside the viewport.
      const cssLeft = page.localLeft * scaleX * zoom;
      const cssTop = page.localTop * scaleY * zoom;
      const cssWidth = page.size.w * scaleX * zoom;
      const cssHeight = page.size.h * scaleY * zoom;

      pageDom.root.style.transform = `translate(${cssLeft}px, ${cssTop}px)`;
      pageDom.root.style.width = `${cssWidth}px`;
      pageDom.root.style.height = `${cssHeight}px`;

      if (!visible) {
        // Retain-only: keep the dom and its rendered bitmap, render nothing.
        continue;
      }

      const renderScale = getPdfRenderScale({
        pageSize: page.size,
        zoom,
        elementScale: Math.max(scaleX, scaleY),
        dpr,
      });
      if (page.kind === 'pdf') {
        this.requestPageRender(
          pageDom,
          page.originalIndex,
          page.size,
          renderScale,
          zoom,
          fastScroll,
        );
      } else {
        this.releasePageRender(pageDom, true);
      }
    }

    this.removeInactivePageDoms(activePagePositions);
  }

  private syncGapButtons(
    viewport: CanvasViewport,
    zoom: number,
    scaleX: number,
    scaleY: number,
    layout: PdfLayout,
  ): void {
    const activePositions = new Set<number>();
    const worldRect = viewport.getWorldRect();

    if (
      layout.pages.length < 1 ||
      !this.isLayoutVisible(worldRect, layout, scaleX, scaleY)
    ) {
      this.removeInactiveGapButtons(activePositions);
      return;
    }

    for (
      let insertPosition = 0;
      insertPosition <= layout.pages.length;
      insertPosition++
    ) {
      let localX: number;
      let localY: number;
      if (this._pageLayout === 'horizontal') {
        if (insertPosition < layout.pages.length) {
          localX = layout.pages[insertPosition].localLeft - PAGE_GAP / 2;
        } else {
          const lastPage = layout.pages[layout.pages.length - 1];
          localX = lastPage.localLeft + lastPage.size.w + PAGE_GAP / 2;
        }
        localY = layout.totalHeight / 2;
      } else {
        localX = layout.totalWidth / 2;
        if (insertPosition < layout.pages.length) {
          localY = layout.pages[insertPosition].localTop - PAGE_GAP / 2;
        } else {
          const lastPage = layout.pages[layout.pages.length - 1];
          localY = lastPage.localTop + lastPage.size.h + PAGE_GAP / 2;
        }
      }
      const worldX = this.offset.x + localX * scaleX;
      const worldY = this.offset.y + localY * scaleY;
      if (this._pageLayout === 'horizontal') {
        if (
          worldX < worldRect.left - PAGE_RENDER_MARGIN ||
          worldX > worldRect.right + PAGE_RENDER_MARGIN
        ) {
          continue;
        }
      } else {
        if (
          worldY < worldRect.top - PAGE_RENDER_MARGIN ||
          worldY > worldRect.bottom + PAGE_RENDER_MARGIN
        ) {
          continue;
        }
      }

      let button = this._gapButtons.get(insertPosition);
      if (!button) {
        button = this.createGapButton(insertPosition);
        this._gapButtons.set(insertPosition, button);
      }
      if (!button.root.isConnected) {
        getFrameChromeControlsLayer()?.appendChild(button.root);
      }
      activePositions.add(insertPosition);

      const screenX = snapToDevicePixel(
        (this.offset.x + viewport.offset.x + localX * scaleX) * zoom,
      );
      const screenY = snapToDevicePixel(
        (this.offset.y + viewport.offset.y + localY * scaleY) * zoom,
      );
      const buttonSize = Math.max(
        MIN_CHROME_BUTTON_PIXEL_SIZE,
        GAP_BUTTON_SIZE * zoom,
      );
      button.sync({ screenX, screenY, size: buttonSize });
    }

    this.removeInactiveGapButtons(activePositions);
  }

  private syncDeleteButtons(
    viewport: CanvasViewport,
    zoom: number,
    scaleX: number,
    scaleY: number,
    layout: PdfLayout,
  ): void {
    const activePositions = new Set<number>();
    const worldRect = viewport.getWorldRect();

    if (
      layout.pages.length < 2 ||
      !this.isLayoutVisible(worldRect, layout, scaleX, scaleY)
    ) {
      this.removeInactiveDeleteButtons(activePositions);
      return;
    }

    for (
      let pagePosition = 0;
      pagePosition < layout.pages.length;
      pagePosition++
    ) {
      const page = layout.pages[pagePosition];
      if (
        !this.isPageVisible(
          worldRect,
          page.localLeft,
          page.localTop,
          page.size,
          scaleX,
          scaleY,
        )
      ) {
        continue;
      }

      let button = this._deleteButtons.get(pagePosition);
      if (!button) {
        button = this.createDeleteButton(pagePosition);
        this._deleteButtons.set(pagePosition, button);
      }
      if (!button.root.isConnected) {
        getFrameChromeControlsLayer()?.appendChild(button.root);
      }
      activePositions.add(pagePosition);

      const localX = page.localLeft + page.size.w - DELETE_BUTTON_OFFSET;
      const localY = page.localTop + DELETE_BUTTON_OFFSET;
      const screenX = snapToDevicePixel(
        (this.offset.x + viewport.offset.x + localX * scaleX) * zoom,
      );
      const screenY = snapToDevicePixel(
        (this.offset.y + viewport.offset.y + localY * scaleY) * zoom,
      );
      const buttonSize = Math.max(
        MIN_CHROME_BUTTON_PIXEL_SIZE,
        DELETE_BUTTON_SIZE * zoom,
      );
      button.sync({ screenX, screenY, size: buttonSize });
    }

    this.removeInactiveDeleteButtons(activePositions);
  }

  private removeInactiveGapButtons(activePositions: Set<number>): void {
    for (const [insertPosition, button] of this._gapButtons) {
      if (!activePositions.has(insertPosition)) {
        button.dispose();
        this._gapButtons.delete(insertPosition);
      }
    }
  }

  private removeInactiveDeleteButtons(activePositions: Set<number>): void {
    for (const [pagePosition, button] of this._deleteButtons) {
      if (!activePositions.has(pagePosition)) {
        button.dispose();
        this._deleteButtons.delete(pagePosition);
      }
    }
  }

  private removeAllGapButtons(): void {
    for (const button of this._gapButtons.values()) {
      button.dispose();
    }
    this._gapButtons.clear();
  }

  private removeAllDeleteButtons(): void {
    for (const button of this._deleteButtons.values()) {
      button.dispose();
    }
    this._deleteButtons.clear();
  }

  private createGapButton(insertPosition: number): PdfChromeButtonHandle {
    return createPdfChromeButton({
      kind: 'add',
      onPress: () => {
        this.insertBlankPage(insertPosition);
      },
    });
  }

  private createDeleteButton(pagePosition: number): PdfChromeButtonHandle {
    return createPdfChromeButton({
      kind: 'delete',
      onPress: () => {
        this.deletePage(pagePosition);
      },
    });
  }

  private insertBlankPage(position: number): void {
    const layout = this.getLayout();
    if (layout.pages.length < 1) {
      return;
    }

    const insertPosition = Math.max(
      0,
      Math.min(Math.floor(position), layout.pages.length),
    );
    const referencePage =
      layout.pages[Math.max(0, insertPosition - 1)] ?? layout.pages[0];
    const nextOrder = clonePageOrder(this.pageEntries);
    nextOrder.splice(insertPosition, 0, {
      kind: 'blank',
      size: { ...referencePage.size },
    });

    this.commitCustomPageOrder(nextOrder);
  }

  private deletePage(position: number): void {
    const layout = this.getLayout();
    if (layout.pages.length <= 1) {
      return;
    }

    const pagePosition = Math.max(
      0,
      Math.min(Math.floor(position), layout.pages.length - 1),
    );
    const nextOrder = clonePageOrder(this.pageEntries);
    nextOrder.splice(pagePosition, 1);
    if (nextOrder.length === 0) {
      return;
    }

    this.commitCustomPageOrder(nextOrder);
  }

  private removeInactivePageDoms(activePagePositions: Set<number>): void {
    const livePageIndices = new Set<number>();
    for (const [pagePosition, pageDom] of this._pageDoms) {
      if (!activePagePositions.has(pagePosition)) {
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

    for (const [pagePosition, pageDom] of this._pageDoms) {
      if (!activePagePositions.has(pagePosition)) {
        this.disposePageDom(pageDom, livePageIndices);
        this._pageDoms.delete(pagePosition);
      }
    }
  }

  private isLayoutVisible(
    worldRect: DOMRect,
    layout: PdfLayout,
    scaleX: number,
    scaleY: number,
  ): boolean {
    const left = this.offset.x;
    const right = left + layout.totalWidth * scaleX;
    const top = this.offset.y;
    const bottom = top + layout.totalHeight * scaleY;
    return (
      right >= worldRect.left &&
      left <= worldRect.right &&
      bottom >= worldRect.top &&
      top <= worldRect.bottom
    );
  }

  private getVisiblePageRange(
    worldRect: DOMRect,
    layout: PdfLayout,
    scaleX: number,
    scaleY: number,
    margin: number,
  ): { start: number; end: number } {
    if (this._pageLayout === 'horizontal') {
      const localLeft = (worldRect.left - margin - this.offset.x) / scaleX;
      const localRight = (worldRect.right + margin - this.offset.x) / scaleX;

      return {
        start: this.findFirstPageEndingAtOrAfter(layout, localLeft),
        end: this.findFirstPageStartingAfter(layout, localRight),
      };
    }

    const localTop = (worldRect.top - margin - this.offset.y) / scaleY;
    const localBottom = (worldRect.bottom + margin - this.offset.y) / scaleY;

    return {
      start: this.findFirstPageEndingAtOrAfter(layout, localTop),
      end: this.findFirstPageStartingAfter(layout, localBottom),
    };
  }

  private findFirstPageEndingAtOrAfter(
    layout: PdfLayout,
    localPosition: number,
  ): number {
    let low = 0;
    let high = layout.pages.length;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      const page = layout.pages[mid];
      const pageEnd =
        this._pageLayout === 'horizontal'
          ? page.localLeft + page.size.w
          : page.localTop + page.size.h;
      if (pageEnd < localPosition) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }
    return low;
  }

  private findFirstPageStartingAfter(
    layout: PdfLayout,
    localPosition: number,
  ): number {
    let low = 0;
    let high = layout.pages.length;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      const pageStart =
        this._pageLayout === 'horizontal'
          ? layout.pages[mid].localLeft
          : layout.pages[mid].localTop;
      if (pageStart <= localPosition) {
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
    zoom: number,
    fastScroll: boolean,
  ): void {
    const pdfDocument = this._pdfDocument;
    if (!pdfDocument) {
      return;
    }

    const key = { pageIndex, renderScale };

    if (isSameRenderKey(pageDom.rendered, key)) {
      this.clearPendingPageRender(pageDom);
      return;
    }

    if (isSameRenderKey(pageDom.rendering, key)) {
      this.clearPendingPageRender(pageDom);
      return;
    }

    if (
      pageDom.pendingRender &&
      isSameRenderKey(pageDom.pendingRender.key, key)
    ) {
      // While scrolling fast, keep pushing the debounce out so the render
      // fires once the viewport settles instead of mid-fling.
      if (!fastScroll && pageDom.pendingRender.zoom === zoom) {
        return;
      }
      this.schedulePageRender(pageDom, pageIndex, pageSize, renderScale, zoom);
      return;
    }

    if (fastScroll || pageDom.rendered?.pageIndex === pageIndex) {
      this.schedulePageRender(pageDom, pageIndex, pageSize, renderScale, zoom);
      return;
    }

    this.startPageRender(pageDom, pageIndex, pageSize, renderScale);
  }

  private schedulePageRender(
    pageDom: PdfPageDom,
    pageIndex: number,
    pageSize: PdfPageSize,
    renderScale: number,
    zoom: number,
  ): void {
    this.clearPendingPageRender(pageDom);
    const key = { pageIndex, renderScale };
    const timeout = window.setTimeout(() => {
      pageDom.pendingRender = null;
      this.startPageRender(pageDom, pageIndex, pageSize, renderScale);
    }, PDF_RENDER_DEBOUNCE_MS);
    pageDom.pendingRender = { key, timeout, zoom };
  }

  private clearPendingPageRender(pageDom: PdfPageDom): void {
    if (pageDom.pendingRender) {
      window.clearTimeout(pageDom.pendingRender.timeout);
    }
    pageDom.pendingRender = null;
  }

  private startPageRender(
    pageDom: PdfPageDom,
    pageIndex: number,
    pageSize: PdfPageSize,
    renderScale: number,
  ): void {
    const pdfDocument = this._pdfDocument;
    if (!pdfDocument) {
      return;
    }

    pageDom.renderHandle?.cancel();
    pageDom.rendering = { pageIndex, renderScale };

    const renderCanvas = this._stagingCanvasPool.acquire();
    const handle = renderPdfPageToCanvas({
      document: pdfDocument,
      pageIndex,
      canvas: renderCanvas,
      renderScale,
    });
    pageDom.renderHandle = handle;

    void handle.promise
      .then(() => {
        if (pageDom.renderHandle !== handle) {
          return;
        }
        const context = pageDom.canvas.getContext('2d');
        if (!context) {
          throw new Error('Failed to create PDF page canvas context');
        }
        pageDom.canvas.width = renderCanvas.width;
        pageDom.canvas.height = renderCanvas.height;
        context.drawImage(renderCanvas, 0, 0);
        pageDom.renderHandle = null;
        pageDom.rendered = { pageIndex, renderScale };
        pageDom.rendering = null;
      })
      .catch((error) => {
        if (isPdfRenderCancelled(error) || pageDom.renderHandle !== handle) {
          return;
        }
        pageDom.renderHandle = null;
        pageDom.rendering = null;
        logger.error('Failed to render PDF page', error, {
          uuid: this.uuid,
          fileName: this._fileName,
          pageIndex,
          pageWidth: pageSize.w,
          pageHeight: pageSize.h,
          renderScale,
        });
      })
      .finally(() => {
        this._stagingCanvasPool.release(renderCanvas);
      });
  }

  private createDom(host: HTMLElement): void {
    const chrome = new FrameChrome({
      kindLabel: getMessages().canvas.frame.pdfKind,
      getMenuItems: () => this.getMenuItems(),
    });
    chrome.setFileName(this._fileName || null);
    chrome.root.dataset.elementUuid = this.uuid;
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
      renderHandle: null,
      rendered: null,
      rendering: null,
      pendingRender: null,
    };
  }
}
