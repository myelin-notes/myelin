import { Download as DownloadIcon } from 'lucide-react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { toast } from 'sonner';
import type * as Y from 'yjs';
import { save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';
import { Logger } from '@/lib/logger';
import type { CanvasViewport } from '../canvas-viewport';
import type { ChromeMenuItem } from '../chrome-menu';
import {
  createPdfExportBytes,
  type PdfElementExportPage,
  type PdfElementExportSource,
} from '../pdf-export';
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
  getFrameChromeControlsLayer,
} from './frame-chrome';
import { PAGE_GAP, PAGE_HEIGHT, PAGE_WIDTH } from './page-frame-constants';

const logger = new Logger('PdfElement');
const DEFAULT_PAGE_SIZE: PdfPageSize = { w: PAGE_WIDTH, h: PAGE_HEIGHT };
const PAGE_RENDER_MARGIN = PAGE_GAP * 2;
const PDF_RENDER_DEBOUNCE_MS = 120;
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
  private _pdfDocument: PDFDocumentProxy | null = null;
  private _chrome: FrameChrome | null = null;
  private _contentRoot: HTMLDivElement | null = null;
  private _pageDoms = new Map<number, PdfPageDom>();
  private _gapButtons = new Map<number, HTMLButtonElement>();
  private _deleteButtons = new Map<number, HTMLButtonElement>();
  private _layout: PdfLayout | null = null;
  private _loadGeneration = 0;
  private _exportElementsProvider: (() => readonly DrawableElement[]) | null =
    null;
  private _pageOrderCustom = false;

  constructor(uuid: string) {
    super(uuid, ElementType.PDF);
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
        this._pageOrder = this.normalizePageOrder(v);
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
    if (!this._pdfBytes) {
      return [];
    }

    return [
      {
        id: 'export-pdf',
        label: 'Export to PDF',
        icon: DownloadIcon,
        onSelect: () => {
          void this.exportPdf();
        },
      },
    ];
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

  private async exportPdf(): Promise<void> {
    const source = this.getExportSource();
    if (!source) {
      return;
    }

    try {
      const path = await save({
        defaultPath: this.getDefaultExportFileName(),
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      });
      if (!path) {
        return;
      }

      const bytes = await createPdfExportBytes(
        source,
        this._exportElementsProvider?.() ?? [],
      );
      await writeFile(path, bytes);
      toast.success('Exported to PDF');
    } catch (err) {
      logger.error('Export to PDF failed', err, {
        uuid: this.uuid,
        fileName: this._fileName,
      });
      toast.error('Export failed', {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private getExportSource(): PdfElementExportSource | null {
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

  private normalizePageOrder(value: unknown): PdfPageOrderEntry[] {
    return normalizePdfPageOrder(
      value,
      this._pageSizes.length,
      DEFAULT_PAGE_SIZE,
      this._pageOrderCustom,
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

  private cancelPageRenders(): void {
    for (const pageDom of this._pageDoms.values()) {
      this.releasePageRender(pageDom, true);
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

    if (!this.isLayoutHorizontallyVisible(worldRect, layout, scaleX)) {
      this.removeInactivePageDoms(activePagePositions);
      return;
    }

    const visibleRange = this.getVisiblePageRange(worldRect, layout, scaleY);
    for (
      let pagePosition = visibleRange.start;
      pagePosition < visibleRange.end;
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

      let pageDom = this._pageDoms.get(pagePosition);
      if (!pageDom) {
        pageDom = this.createPageDom(contentRoot);
        this._pageDoms.set(pagePosition, pageDom);
      }
      activePagePositions.add(pagePosition);

      const cssLeft = page.localLeft * scaleX * zoom;
      const cssTop = page.localTop * scaleY * zoom;
      const cssWidth = page.size.w * scaleX * zoom;
      const cssHeight = page.size.h * scaleY * zoom;

      pageDom.root.style.transform = `translate(${cssLeft}px, ${cssTop}px)`;
      pageDom.root.style.width = `${cssWidth}px`;
      pageDom.root.style.height = `${cssHeight}px`;

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
      layout.pages.length < 2 ||
      !this.isLayoutHorizontallyVisible(worldRect, layout, scaleX)
    ) {
      this.removeInactiveGapButtons(activePositions);
      return;
    }

    for (
      let insertPosition = 1;
      insertPosition < layout.pages.length;
      insertPosition++
    ) {
      const page = layout.pages[insertPosition];
      const localY = page.localTop - PAGE_GAP / 2;
      const worldY = this.offset.y + localY * scaleY;
      if (
        worldY < worldRect.top - PAGE_RENDER_MARGIN ||
        worldY > worldRect.bottom + PAGE_RENDER_MARGIN
      ) {
        continue;
      }

      let button = this._gapButtons.get(insertPosition);
      if (!button) {
        button = this.createGapButton(insertPosition);
        this._gapButtons.set(insertPosition, button);
      }
      if (!button.isConnected) {
        getFrameChromeControlsLayer()?.appendChild(button);
      }
      activePositions.add(insertPosition);

      const localX = layout.totalWidth / 2;
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
      button.style.visibility = 'visible';
      button.style.transform = `translate(${screenX - buttonSize / 2}px, ${screenY - buttonSize / 2}px)`;
      button.style.width = `${buttonSize}px`;
      button.style.height = `${buttonSize}px`;
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
      !this.isLayoutHorizontallyVisible(worldRect, layout, scaleX)
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
      if (!button.isConnected) {
        getFrameChromeControlsLayer()?.appendChild(button);
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
      button.style.visibility = 'visible';
      button.style.transform = `translate(${screenX - buttonSize / 2}px, ${screenY - buttonSize / 2}px)`;
      button.style.width = `${buttonSize}px`;
      button.style.height = `${buttonSize}px`;
    }

    this.removeInactiveDeleteButtons(activePositions);
  }

  private removeInactiveGapButtons(activePositions: Set<number>): void {
    for (const [insertPosition, button] of this._gapButtons) {
      if (!activePositions.has(insertPosition)) {
        button.remove();
        this._gapButtons.delete(insertPosition);
      }
    }
  }

  private removeInactiveDeleteButtons(activePositions: Set<number>): void {
    for (const [pagePosition, button] of this._deleteButtons) {
      if (!activePositions.has(pagePosition)) {
        button.remove();
        this._deleteButtons.delete(pagePosition);
      }
    }
  }

  private removeAllGapButtons(): void {
    for (const button of this._gapButtons.values()) {
      button.remove();
    }
    this._gapButtons.clear();
  }

  private removeAllDeleteButtons(): void {
    for (const button of this._deleteButtons.values()) {
      button.remove();
    }
    this._deleteButtons.clear();
  }

  private createGapButton(insertPosition: number): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pdf-chrome-button pdf-chrome-button--add';
    button.title = 'Add blank page';
    button.setAttribute('aria-label', 'Add blank page');
    button.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none"
        stroke="currentColor" stroke-width="1.5"
        stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 5v14"/>
        <path d="M5 12h14"/>
      </svg>
    `;

    button.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
    });
    button.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      this.insertBlankPage(insertPosition);
    });

    getFrameChromeControlsLayer()?.appendChild(button);
    return button;
  }

  private createDeleteButton(pagePosition: number): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pdf-chrome-button pdf-chrome-button--delete';
    button.title = 'Delete page';
    button.setAttribute('aria-label', 'Delete page');
    button.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none"
        stroke="currentColor" stroke-width="1.5"
        stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M4 7h16"/>
        <path d="M9.5 7V5.5a1.5 1.5 0 0 1 1.5-1.5h2a1.5 1.5 0 0 1 1.5 1.5V7"/>
        <path d="M18 7l-.9 11.1A2 2 0 0 1 15.1 20H8.9a2 2 0 0 1-2-1.9L6 7"/>
        <path d="M10 11.5v4.5"/>
        <path d="M14 11.5v4.5"/>
      </svg>
    `;

    button.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
    });
    button.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      this.deletePage(pagePosition);
    });

    getFrameChromeControlsLayer()?.appendChild(button);
    return button;
  }

  private insertBlankPage(position: number): void {
    const layout = this.getLayout();
    if (layout.pages.length < 2) {
      return;
    }

    const insertPosition = Math.max(
      1,
      Math.min(Math.floor(position), layout.pages.length - 1),
    );
    const previousPage = layout.pages[insertPosition - 1];
    const nextOrder = clonePageOrder(this.pageEntries);
    nextOrder.splice(insertPosition, 0, {
      kind: 'blank',
      size: { ...previousPage.size },
    });

    this._pageOrder = nextOrder;
    this._pageOrderCustom = true;
    this._layout = null;
    this.invalidatePageRenders();
    this.removeAllGapButtons();
    this.removeAllDeleteButtons();
    this.syncToYMap({
      pageOrder: clonePageOrder(this._pageOrder),
      pageOrderCustom: true,
    });
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

    this._pageOrder = nextOrder;
    this._pageOrderCustom = true;
    this._layout = null;
    this.invalidatePageRenders();
    this.removeAllGapButtons();
    this.removeAllDeleteButtons();
    this.syncToYMap({
      pageOrder: clonePageOrder(this._pageOrder),
      pageOrderCustom: true,
    });
  }

  private removeInactivePageDoms(activePagePositions: Set<number>): void {
    for (const [pagePosition, pageDom] of this._pageDoms) {
      if (!activePagePositions.has(pagePosition)) {
        this.disposePageDom(pageDom);
        this._pageDoms.delete(pagePosition);
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
    let high = layout.pages.length;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      const page = layout.pages[mid];
      const pageBottom = page.localTop + page.size.h;
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
    let high = layout.pages.length;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (layout.pages[mid].localTop <= localY) {
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
      if (pageDom.pendingRender.zoom === zoom) {
        return;
      }
      this.schedulePageRender(pageDom, pageIndex, pageSize, renderScale, zoom);
      return;
    }

    if (pageDom.rendered?.pageIndex === pageIndex) {
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

    const renderCanvas = document.createElement('canvas');
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
        renderCanvas.width = 1;
        renderCanvas.height = 1;
      });
  }

  private createDom(host: HTMLElement): void {
    const chrome = new FrameChrome({
      kindLabel: 'PDF',
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
      rendered: null,
      rendering: null,
      pendingRender: null,
    };
  }
}
