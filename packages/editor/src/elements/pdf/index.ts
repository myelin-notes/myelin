import {
  Columns3 as ColumnsIcon,
  Download as DownloadIcon,
  Rows3 as RowsIcon,
} from 'lucide-react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type * as Y from 'yjs';
import { Logger } from '@myelin/shared/logger';
import type { CanvasViewport } from '../../canvas-viewport';
import type { ChromeMenuItem } from '../../chrome-menu';
import {
  type ExportOptions,
  type ExportResult,
  type ExportTarget,
  openExportDialog,
} from '../../export/export-controller';
import { getMessages } from '../../i18n';
import {
  buildPdfElementRequest,
  type PdfElementExportPdfPage,
  type PdfElementExportSource,
  prepareExportOverlays,
} from '../../pdf-element-export';
import { bytesToBase64 } from '../../pdf-export/contract';
import {
  getPdfDocumentPageSizes,
  getPdfRenderScale,
  isPdfRenderCancelled,
  normalizePdfPageSizes,
  openPdfDocument,
  type PdfPageSize,
  renderPdfPageToCanvas,
} from '../../pdf-renderer';
import { getPlatform } from '../../platform';
import { quantizeRasterZoom } from '../../raster-zoom';
import type { CanvasElementContext } from '../canvas-element-context';
import { DrawableElement, ResizeHandles } from '../drawable-element';
import { ElementType } from '../element-type';
import {
  CHROME_BOTTOM_PADDING,
  CHROME_HEADER_HEIGHT,
  CHROME_SIDE_PADDING,
  FrameChrome,
} from '../frame/chrome';
import type { PageLayout } from '../page-frame-constants';
import type {
  CanvasPdfExportData,
  PdfExportableElement,
} from '../pdf-exportable-element';
import { PdfChromeController } from './chrome-controller';
import {
  cloneBytes,
  DEFAULT_PDF_PAGE_SIZE,
  PdfDocumentModel,
} from './document-model';
import {
  createPdfExportSource,
  getPdfExportFileName,
  getPositiveScale,
} from './export-adapter';
import { isPdfPageVisible, PDF_PAGE_RENDER_MARGIN } from './layout';
import { PdfPageView } from './page-view';

const logger = new Logger('PdfElement');

export class PdfElement
  extends DrawableElement
  implements PdfExportableElement
{
  private readonly model: PdfDocumentModel;
  private readonly pageView: PdfPageView;
  private readonly chromeController: PdfChromeController;
  private _pdfDocument: PDFDocumentProxy | null = null;
  private _chrome: FrameChrome | null = null;
  private _contentRoot: HTMLDivElement | null = null;
  private _loadGeneration = 0;
  private _exportElementsProvider: (() => readonly DrawableElement[]) | null =
    null;
  private _thumbnailPages: {
    canvas: HTMLCanvasElement;
    page: PdfElementExportPdfPage;
  }[] = [];
  private _pdfLoadPromise: Promise<void> | null = null;

  public constructor(uuid: string, pageLayout: PageLayout = 'vertical') {
    super(uuid, ElementType.PDF);
    this.model = new PdfDocumentModel(pageLayout);
    this.pageView = new PdfPageView({
      onRenderError: ({
        error,
        pageIndex,
        pageWidth,
        pageHeight,
        renderScale,
      }) => {
        logger.error('Failed to render PDF page', error, {
          uuid: this.uuid,
          fileName: this.model.fileName,
          pageIndex,
          pageWidth,
          pageHeight,
          renderScale,
        });
      },
    });
    this.chromeController = new PdfChromeController(
      () => this._chrome?.controlsLayer ?? null,
      (position) => this.insertBlankPage(position),
      (position) => this.deletePage(position),
    );
  }

  public setExportElementsProvider(
    provider: () => readonly DrawableElement[],
  ): void {
    this._exportElementsProvider = provider;
  }

  public override configureCanvas(context: CanvasElementContext): void {
    this.setExportElementsProvider(context.getElements);
  }

  public override get resizeHandles(): ResizeHandles {
    return ResizeHandles.Corners;
  }

  public override get maintainAspectRatio(): boolean {
    return true;
  }

  public override getYMapProps(): Record<string, unknown> {
    return this.model.getYMapProps();
  }

  public override bindToYMap(yMap: Y.Map<unknown>): void {
    super.bindToYMap(yMap);
    this.bindYFields(yMap, {
      pageSizes: (value) => {
        this.setPageSizes(normalizePdfPageSizes(value), false);
      },
      pageOrderCustom: (value) => {
        this.model.setPageOrderCustom(value === true);
      },
      pageOrder: (value) => {
        const allowMissing =
          yMap.get('pageOrderCustom') === true ||
          this.model.metadata.pageOrderCustom;
        this.applyPageOrder(value, allowMissing);
      },
      pageLayout: (value) => {
        this.setPageLayoutInternal(
          value === 'horizontal' ? 'horizontal' : 'vertical',
          false,
        );
      },
      pdfData: (value) => {
        if (!(value instanceof Uint8Array)) {
          return;
        }
        const replacingPdf = this.model.bytes !== null;
        this.model.setBytes(value);
        this._pdfLoadPromise = this.loadPdfBytes(
          this.model.bytes!,
          true,
          replacingPdf,
        );
      },
      fileName: (value) => {
        this.model.setFileName(typeof value === 'string' ? value : '');
        this._chrome?.setFileName(this.model.fileName || null);
      },
    });
  }

  public setInitialPdfData(
    bytes: Uint8Array,
    fileName: string,
    pageSizes: PdfPageSize[] = [DEFAULT_PDF_PAGE_SIZE],
  ): void {
    this.model.setBytes(bytes);
    this.model.setFileName(fileName);
    this._chrome?.setFileName(fileName || null);
    this.setPageSizes(pageSizes, false);
    this.syncToYMap({
      pdfData: cloneBytes(bytes),
      ...this.model.metadata,
      fileName,
    });
    this._pdfLoadPromise = this.loadPdfBytes(bytes, false, false);
  }

  public get fileName(): string {
    return this.model.fileName;
  }

  public get pageLayout(): PageLayout {
    return this.model.pageLayout;
  }

  public setPageLayout(pageLayout: PageLayout): void {
    this.setPageLayoutInternal(pageLayout, true);
  }

  public getMenuItems(): ChromeMenuItem[] {
    if (!this.model.bytes) {
      return [];
    }
    const strings = getMessages().canvas.frame;
    return [
      {
        id: 'layout-vertical',
        label: strings.pages,
        icon: RowsIcon,
        checked: this.model.pageLayout === 'vertical',
        onSelect: () => this.setPageLayout('vertical'),
      },
      {
        id: 'layout-horizontal',
        label: strings.columns,
        icon: ColumnsIcon,
        checked: this.model.pageLayout === 'horizontal',
        onSelect: () => this.setPageLayout('horizontal'),
      },
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

  public get totalWidth(): number {
    return this.model.layout.totalWidth;
  }

  public get totalHeight(): number {
    return this.model.layout.totalHeight;
  }

  public get localBoundingBox(): DOMRect {
    return new DOMRect(
      -CHROME_SIDE_PADDING,
      -CHROME_HEADER_HEIGHT,
      this.totalWidth + CHROME_SIDE_PADDING * 2,
      this.totalHeight + CHROME_HEADER_HEIGHT + CHROME_BOTTOM_PADDING,
    );
  }

  public override get boundingBox(): DOMRect {
    const contentWidth = this.totalWidth * this._scale.x;
    const contentHeight = this.totalHeight * this._scale.y;
    return new DOMRect(
      this.offset.x - CHROME_SIDE_PADDING,
      this.offset.y - CHROME_HEADER_HEIGHT,
      contentWidth + CHROME_SIDE_PADDING * 2,
      contentHeight + CHROME_HEADER_HEIGHT + CHROME_BOTTOM_PADDING,
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

  public override async prepareThumbnail(
    scale: number,
    region: DOMRect,
  ): Promise<void> {
    this._thumbnailPages = [];
    await this._pdfLoadPromise;
    if (!this._pdfDocument) {
      return;
    }
    const scaleX = getPositiveScale(this._scale.x);
    const scaleY = getPositiveScale(this._scale.y);
    for (const page of this.model.layout.pages) {
      if (
        page.kind !== 'pdf' ||
        !isPdfPageVisible({
          worldRect: region,
          offset: this.offset,
          localLeft: page.localLeft,
          localTop: page.localTop,
          pageSize: page.size,
          scaleX,
          scaleY,
          verticalMargin: PDF_PAGE_RENDER_MARGIN,
        })
      ) {
        continue;
      }
      const canvas = document.createElement('canvas');
      const renderScale = getPdfRenderScale({
        pageSize: page.size,
        zoom: scale,
        elementScale: Math.max(scaleX, scaleY),
        dpr: 1,
      });
      try {
        await renderPdfPageToCanvas({
          document: this._pdfDocument,
          pageIndex: page.originalIndex,
          canvas,
          renderScale,
        }).promise;
      } catch (error) {
        if (!isPdfRenderCancelled(error)) {
          logger.error('Failed to render PDF thumbnail page', error, {
            uuid: this.uuid,
            fileName: this.model.fileName,
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

  public getPdfExportSource(): PdfElementExportSource | null {
    return createPdfExportSource({
      uuid: this.uuid,
      model: this.model,
      offset: this.offset,
      scale: this.scale,
      boundingBox: this.boundingBox,
    });
  }

  public getCanvasPdfExportData(): CanvasPdfExportData {
    return { kind: 'pdf', source: this.getPdfExportSource() };
  }

  public override syncDOM(viewport: CanvasViewport, host: HTMLElement): void {
    if (!this._chrome) {
      this.createDom(host);
    }
    const zoom = viewport.zoom;
    const scaleX = getPositiveScale(this._scale.x);
    const scaleY = getPositiveScale(this._scale.y);
    const layout = this.model.layout;
    const contentWidth = layout.totalWidth * scaleX;
    const contentHeight = layout.totalHeight * scaleY;
    this._chrome?.sync({
      screenX: snapToDevicePixel((this.offset.x + viewport.offset.x) * zoom),
      screenY: snapToDevicePixel((this.offset.y + viewport.offset.y) * zoom),
      contentWidth,
      contentHeight,
      zoom,
    });
    const rasterZoom = quantizeRasterZoom(zoom);
    this.syncContentRoot(contentWidth, contentHeight, rasterZoom);
    this.pageView.sync({
      contentRoot: this._contentRoot,
      document: this._pdfDocument,
      viewport,
      zoom,
      rasterZoom,
      offset: this.offset,
      scaleX,
      scaleY,
      pageLayout: this.model.pageLayout,
      layout,
    });
    this.chromeController.sync({
      viewport,
      zoom,
      offset: this.offset,
      scaleX,
      scaleY,
      pageLayout: this.model.pageLayout,
      layout,
    });
  }

  public override setDomZIndex(zIndex: string): void {
    this._chrome?.setZIndex(zIndex);
    this.chromeController.setZIndex(zIndex);
  }

  public override disposeDOM(): void {
    super.disposeDOM();
    this._loadGeneration++;
    this.pageView.dispose(this._pdfDocument);
    this._pdfDocument = null;
    this._thumbnailPages = [];
    this.chromeController.clear();
    this._contentRoot = null;
    this._chrome?.dispose();
    this._chrome = null;
  }

  private buildExportTarget(): ExportTarget {
    return {
      title: this.model.fileName || 'PDF',
      formats: ['pdf'],
      supportsAnnotations: true,
      run: (options) => this.runExport(options),
    };
  }

  private async runExport({
    includeAnnotations,
  }: ExportOptions): Promise<ExportResult> {
    const pdfExport = getPlatform().pdfExport;
    const source = this.getPdfExportSource();
    if (!pdfExport || !source) {
      return pdfExport ? {} : { cancelled: true };
    }
    const outcome = await pdfExport.export({
      suggestedName: getPdfExportFileName(this.model.fileName),
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

  private setPageLayoutInternal(pageLayout: PageLayout, sync: boolean): void {
    if (!this.model.setPageLayout(pageLayout)) {
      return;
    }
    this.chromeController.clear();
    if (sync) {
      this.syncToYMap({ pageLayout: this.model.pageLayout });
    }
  }

  private setPageSizes(pageSizes: PdfPageSize[], sync: boolean): void {
    this.model.setPageSizes(pageSizes);
    this.pageView.invalidate();
    if (
      sync &&
      this._yMap &&
      this.model.differsFromStoredMetadata({
        hasPageSizes: this._yMap.has('pageSizes'),
        hasPageOrder: this._yMap.has('pageOrder'),
        pageSizes: this._yMap.get('pageSizes'),
        pageOrder: this._yMap.get('pageOrder'),
        pageOrderCustom: this._yMap.get('pageOrderCustom'),
      })
    ) {
      this.syncToYMap({ ...this.model.metadata });
    }
  }

  private applyPageOrder(value: unknown, allowMissing: boolean): void {
    const previousPages = this.model.layout.pages;
    this.model.setPageOrder(value, allowMissing);
    this.pageView.reconcileOrder(
      previousPages,
      this.model.layout.pages,
      this._pdfDocument,
    );
    this.chromeController.clear();
  }

  private insertBlankPage(position: number): void {
    const previousPages = this.model.layout.pages;
    if (!this.model.insertBlankPage(position)) {
      return;
    }
    this.pageView.reconcileOrder(
      previousPages,
      this.model.layout.pages,
      this._pdfDocument,
    );
    this.chromeController.clear();
    this.syncToYMap({
      pageOrder: this.model.pageEntries,
      pageOrderCustom: true,
    });
  }

  private deletePage(position: number): void {
    const previousPages = this.model.layout.pages;
    if (!this.model.deletePage(position)) {
      return;
    }
    this.pageView.reconcileOrder(
      previousPages,
      this.model.layout.pages,
      this._pdfDocument,
    );
    this.chromeController.clear();
    this.syncToYMap({
      pageOrder: this.model.pageEntries,
      pageOrderCustom: true,
    });
  }

  private async loadPdfBytes(
    bytes: Uint8Array,
    syncMetadata: boolean,
    forceMetadata: boolean,
  ): Promise<void> {
    const generation = ++this._loadGeneration;
    this.pageView.invalidate();
    void this._pdfDocument?.loadingTask.destroy();
    this._pdfDocument = null;
    try {
      const document = await openPdfDocument(bytes);
      if (generation !== this._loadGeneration) {
        await document.loadingTask.destroy();
        return;
      }
      this._pdfDocument = document;
      if (
        !forceMetadata &&
        !this.model.shouldLoadPageMetadata({
          hasPageSizes: this._yMap?.has('pageSizes') ?? false,
          hasPageOrder: this._yMap?.has('pageOrder') ?? false,
          pageCount: document.numPages,
        })
      ) {
        return;
      }
      const pageSizes = await getPdfDocumentPageSizes(document);
      if (generation !== this._loadGeneration) {
        return;
      }
      this.setPageSizes(pageSizes, syncMetadata);
    } catch (error) {
      if (generation === this._loadGeneration) {
        logger.error('Failed to load PDF', error, {
          uuid: this.uuid,
          fileName: this.model.fileName,
        });
      }
    }
  }

  private syncContentRoot(
    contentWidth: number,
    contentHeight: number,
    rasterZoom: number,
  ): void {
    if (!this._contentRoot) {
      return;
    }
    this._contentRoot.style.width = `${contentWidth * rasterZoom}px`;
    this._contentRoot.style.height = `${contentHeight * rasterZoom}px`;
  }

  private createDom(host: HTMLElement): void {
    const chrome = new FrameChrome(
      {
        kindLabel: getMessages().canvas.frame.pdfKind,
        getMenuItems: () => this.getMenuItems(),
      },
      host,
    );
    chrome.setFileName(this.model.fileName || null);
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
}

function snapToDevicePixel(value: number): number {
  const dpr = window.devicePixelRatio || 1;
  return Math.round(value * dpr) / dpr;
}
