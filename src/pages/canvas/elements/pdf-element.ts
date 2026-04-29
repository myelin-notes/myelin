import type * as Y from 'yjs';
import { Logger } from '@/lib/logger';
import { loadDocument, type PdfDocument, renderPage } from '@/lib/pdf-renderer';
import { timeEnd, timeStart } from '@/lib/pdf-renderer/pdf-perf';
import type { CanvasViewport } from '../canvas-viewport';
import type { ChromeMenuItem } from '../chrome-menu';
import { bindYFields } from '../y-fields';
import { DrawableElement, ResizeHandles } from './drawable-element';
import { ElementType } from './element-type';
import {
  CHROME_BOTTOM_PADDING,
  CHROME_HEADER_HEIGHT,
  CHROME_SIDE_PADDING,
  FrameChrome,
} from './frame-chrome';

const PDF_PAGE_GAP = 40;
const ZOOM_SETTLE_MS = 150;
const logger = new Logger('PdfElement');

let pdfStylesInjected = false;
function injectPdfStyles(): void {
  if (pdfStylesInjected) {
    return;
  }
  pdfStylesInjected = true;
  const style = document.createElement('style');
  // Hide the text layer while the viewport is zooming. Text spans repaint at
  // every parent scale change; canvas content GPU-resamples for free.
  // Restored on settle so selection / Cmd+F still work.
  style.textContent = `.pdf-zooming .pdf-text { visibility: hidden; }`;
  document.head.appendChild(style);
}

export type PdfPageEntry =
  | { kind: 'pdf'; originalIndex: number }
  | { kind: 'blank'; w: number; h: number };

export interface PdfPageSize {
  w: number;
  h: number;
}

interface PageSlot {
  key: string;
  div: HTMLDivElement;
  contentDiv: HTMLDivElement;
}

function snapToDevicePixel(value: number): number {
  const dpr = window.devicePixelRatio || 1;
  return Math.round(value * dpr) / dpr;
}

function entryKey(entry: PdfPageEntry): string {
  return entry.kind === 'pdf'
    ? `pdf:${entry.originalIndex}`
    : `blank:${entry.w}x${entry.h}`;
}

function entrySize(
  entry: PdfPageEntry,
  pageSizes: readonly PdfPageSize[],
): PdfPageSize {
  if (entry.kind === 'pdf') {
    return pageSizes[entry.originalIndex] ?? { w: 612, h: 792 };
  }
  return { w: entry.w, h: entry.h };
}

export class PdfElement extends DrawableElement {
  private _pdfBytes: Uint8Array | null = null;
  private _pdfDoc: PdfDocument | null = null;
  private _pdfDocLoad: Promise<PdfDocument> | null = null;
  private _pageOrder: PdfPageEntry[] = [];
  private _pageSizes: PdfPageSize[] = [];
  private _fileName: string = '';

  private _chrome: FrameChrome | null = null;
  private _frameDiv: HTMLDivElement | null = null;
  private _viewportDiv: HTMLDivElement | null = null;
  private _pageHost: HTMLDivElement | null = null;
  private _slots: Map<number, PageSlot> = new Map();
  private _lastZoomXY = { zoom: -1, sX: -1, sY: -1 };
  private _zoomSettleTimer: number | null = null;

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
    return {
      pageOrder: this._pageOrder as unknown,
      pageSizes: this._pageSizes as unknown,
      fileName: this._fileName,
    };
  }

  public override bindToYMap(yMap: Y.Map<unknown>): void {
    super.bindToYMap(yMap);
    bindYFields(yMap, {
      pdfData: (v) => {
        this._pdfBytes = new Uint8Array(v as Uint8Array);
        this.ensurePdfDoc();
      },
      pageOrder: (v) => {
        this._pageOrder = v as PdfPageEntry[];
      },
      pageSizes: (v) => {
        this._pageSizes = v as PdfPageSize[];
      },
      fileName: (v) => {
        this._fileName = (v as string) ?? '';
        this._chrome?.setFileName(this._fileName || null);
      },
    });
  }

  private ensurePdfDoc(): void {
    if (this._pdfDoc || !this._pdfBytes || this._pdfDocLoad) {
      return;
    }
    const bytes = this._pdfBytes;
    this._pdfDocLoad = loadDocument(bytes).then((doc) => {
      this._pdfDoc = doc;
      return doc;
    });
    this._pdfDocLoad.catch((err) => {
      logger.error('Failed to load document', err, { index: this.index });
      this._pdfDocLoad = null;
    });
  }

  public setInitialPdfData(
    bytes: Uint8Array,
    pageSizes: PdfPageSize[],
    fileName: string,
    preloaded?: PdfDocument,
  ): void {
    if (preloaded) {
      this._pdfDoc = preloaded;
    }
    this._pdfBytes = bytes;
    this._pageSizes = pageSizes;
    this._pageOrder = pageSizes.map((_, i) => ({
      kind: 'pdf',
      originalIndex: i,
    }));
    this._fileName = fileName;
    this._chrome?.setFileName(fileName || null);

    this.syncToYMap({
      pdfData: new Uint8Array(bytes),
      pageSizes: this._pageSizes as unknown,
      pageOrder: this._pageOrder as unknown,
      fileName,
    });
  }

  public get fileName(): string {
    return this._fileName;
  }

  public getMenuItems(): ChromeMenuItem[] {
    return [];
  }

  /** y/height/w for each rendered page in local space, plus `gapAfter`. */
  private pageLayout(): Array<{
    y: number;
    w: number;
    h: number;
    gapAfter: number;
    entry: PdfPageEntry;
  }> {
    const out: Array<{
      y: number;
      w: number;
      h: number;
      gapAfter: number;
      entry: PdfPageEntry;
    }> = [];
    let y = 0;
    for (let i = 0; i < this._pageOrder.length; i++) {
      const entry = this._pageOrder[i];
      const { w, h } = entrySize(entry, this._pageSizes);
      const isLast = i === this._pageOrder.length - 1;
      const gapAfter = isLast ? 0 : PDF_PAGE_GAP;
      out.push({ y, w, h, gapAfter, entry });
      y += h + gapAfter;
    }
    return out;
  }

  public get totalWidth(): number {
    let maxW = 0;
    for (const size of this._pageSizes) {
      if (size.w > maxW) {
        maxW = size.w;
      }
    }
    for (const entry of this._pageOrder) {
      if (entry.kind === 'blank' && entry.w > maxW) {
        maxW = entry.w;
      }
    }
    return maxW;
  }

  public get totalHeight(): number {
    const layout = this.pageLayout();
    if (layout.length === 0) {
      return 0;
    }
    const last = layout[layout.length - 1];
    return last.y + last.h;
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
   * Content scales with `_scale`; chrome padding is fixed world units (the
   * paper backing is a constant visual size regardless of how the PDF is
   * resized). Override so selection outline + handles track the visible
   * chrome — the base implementation would scale chrome padding too.
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
    // Chrome (frame + header) hit area — lets users select/drag by the
    // surrounding paper backing.
    if (
      x >= -CHROME_SIDE_PADDING &&
      x <= this.totalWidth + CHROME_SIDE_PADDING &&
      y >= -CHROME_HEADER_HEIGHT &&
      y <= this.totalHeight + CHROME_BOTTOM_PADDING
    ) {
      return true;
    }
    for (const page of this.pageLayout()) {
      if (x < 0 || x > page.w) {
        continue;
      }
      if (y >= page.y && y <= page.y + page.h) {
        return true;
      }
    }
    return false;
  }

  protected updateBoundingBox(): void {}

  protected draw2D(_ctx: CanvasRenderingContext2D, _deltaTime: number): void {}

  public override syncDOM(viewport: CanvasViewport, host: HTMLElement): void {
    const t0 = timeStart();
    this.ensurePdfDoc();

    if (!this._frameDiv) {
      this.createDom(host);
    }

    const frameDiv = this._frameDiv!;
    const viewportDiv = this._viewportDiv!;
    const chrome = this._chrome!;

    const zoom = viewport.zoom;
    const offset = viewport.offset;
    const dpr = window.devicePixelRatio || 1;
    const totalWidth = this.totalWidth;
    const totalHeight = this.totalHeight;
    const sX = this._scale.x;
    const sY = this._scale.y;
    const scaledWidth = totalWidth * sX;
    const scaledHeight = totalHeight * sY;

    const screenX = snapToDevicePixel((this.offset.x + offset.x) * zoom);
    const screenY = snapToDevicePixel((this.offset.y + offset.y) * zoom);

    chrome.sync({
      screenX,
      screenY,
      contentWidth: scaledWidth,
      contentHeight: scaledHeight,
      zoom,
    });

    // frameDiv lives inside chrome.contentSlot — sized in screen pixels like
    // the old standalone frame. No translate needed; position via its parent.
    frameDiv.style.width = `${scaledWidth * zoom}px`;
    frameDiv.style.height = `${scaledHeight * zoom}px`;
    frameDiv.style.pointerEvents = 'none';

    // viewportDiv holds pages at intrinsic size; element scale + canvas zoom
    // are both applied via transform so page rasters don't need reflowing.
    viewportDiv.style.width = `${totalWidth}px`;
    viewportDiv.style.height = `${totalHeight}px`;
    viewportDiv.style.zoom = `${dpr}`;
    viewportDiv.style.transform = `scale(${(zoom * sX) / dpr}, ${(zoom * sY) / dpr})`;

    const last = this._lastZoomXY;
    if (
      Math.abs(zoom - last.zoom) > 1e-6 ||
      Math.abs(sX - last.sX) > 1e-6 ||
      Math.abs(sY - last.sY) > 1e-6
    ) {
      last.zoom = zoom;
      last.sX = sX;
      last.sY = sY;
      if (!viewportDiv.classList.contains('pdf-zooming')) {
        viewportDiv.classList.add('pdf-zooming');
      }
      if (this._zoomSettleTimer !== null) {
        window.clearTimeout(this._zoomSettleTimer);
      }
      this._zoomSettleTimer = window.setTimeout(() => {
        viewportDiv.classList.remove('pdf-zooming');
        this._zoomSettleTimer = null;
      }, ZOOM_SETTLE_MS);
    }

    const sp = timeStart();
    this.syncPages();
    timeEnd('pdfElement.syncPages', sp);
    timeEnd('pdfElement.syncDOM', t0);
  }

  public override disposeDOM(): void {
    if (this._zoomSettleTimer !== null) {
      window.clearTimeout(this._zoomSettleTimer);
      this._zoomSettleTimer = null;
    }
    this._chrome?.dispose();
    this._chrome = null;
    this._frameDiv = null;
    this._viewportDiv = null;
    this._pageHost = null;
    this._slots.clear();
    this._pdfDoc?.destroy();
    this._pdfDoc = null;
  }

  private createDom(host: HTMLElement): void {
    injectPdfStyles();
    const chrome = new FrameChrome({
      kindLabel: 'PDF',
      getMenuItems: () => this.getMenuItems(),
    });
    chrome.setFileName(this._fileName || null);
    chrome.root.dataset.elementIndex = String(this.index);
    chrome.root.dataset.elementType = 'pdf';

    const frameDiv = document.createElement('div');
    Object.assign(frameDiv.style, {
      position: 'absolute',
      left: '0px',
      top: '0px',
      transformOrigin: '0 0',
      overflow: 'visible',
    } as Partial<CSSStyleDeclaration>);

    const viewportDiv = document.createElement('div');
    Object.assign(viewportDiv.style, {
      position: 'absolute',
      left: '0px',
      top: '0px',
      transformOrigin: '0 0',
    } as Partial<CSSStyleDeclaration>);

    const pageHost = document.createElement('div');
    Object.assign(pageHost.style, {
      position: 'absolute',
      left: '0px',
      top: '0px',
      width: '100%',
      height: '100%',
    } as Partial<CSSStyleDeclaration>);

    viewportDiv.appendChild(pageHost);
    frameDiv.appendChild(viewportDiv);
    chrome.contentSlot.appendChild(frameDiv);
    host.appendChild(chrome.root);

    this._chrome = chrome;
    this._frameDiv = frameDiv;
    this._viewportDiv = viewportDiv;
    this._pageHost = pageHost;
  }

  private syncPages(): void {
    const pageHost = this._pageHost;
    if (!pageHost) {
      return;
    }
    const layout = this.pageLayout();
    const kept = new Set<number>();

    for (let i = 0; i < layout.length; i++) {
      const page = layout[i];
      const key = entryKey(page.entry);
      let slot = this._slots.get(i);

      if (slot && slot.key !== key) {
        slot.div.remove();
        this._slots.delete(i);
        slot = undefined;
      }

      if (!slot) {
        slot = this.createPageSlot(key, page.w, page.h);
        pageHost.appendChild(slot.div);
        this._slots.set(i, slot);
        if (page.entry.kind === 'pdf') {
          this.renderPdfPageInto(slot, page.entry.originalIndex);
        }
      }

      slot.div.style.width = `${page.w}px`;
      slot.div.style.height = `${page.h}px`;
      slot.div.style.transform = `translate(0px, ${page.y}px)`;

      kept.add(i);
    }

    for (const [idx, slot] of this._slots) {
      if (!kept.has(idx)) {
        slot.div.remove();
        this._slots.delete(idx);
      }
    }
  }

  private createPageSlot(key: string, w: number, h: number): PageSlot {
    const div = document.createElement('div');
    Object.assign(div.style, {
      position: 'absolute',
      left: '0px',
      top: '0px',
      width: `${w}px`,
      height: `${h}px`,
      background: '#ffffff',
      borderRadius: '3px',
      boxShadow: '0 4px 24px rgba(25, 28, 30, 0.08)',
      overflow: 'hidden',
      transformOrigin: '0 0',
      contain: 'paint',
      willChange: 'transform',
    } as Partial<CSSStyleDeclaration>);
    div.dataset.pageKey = key;

    const contentDiv = document.createElement('div');
    Object.assign(contentDiv.style, {
      position: 'absolute',
      inset: '0',
    } as Partial<CSSStyleDeclaration>);
    div.appendChild(contentDiv);

    return { key, div, contentDiv };
  }

  private async renderPdfPageInto(
    slot: PageSlot,
    originalIndex: number,
  ): Promise<void> {
    try {
      const doc = this._pdfDoc ?? (await this._pdfDocLoad);
      if (!doc) {
        return;
      }
      if (!this._slots.has(this.findSlotIndex(slot))) {
        return;
      }
      const rendered = await renderPage(doc, originalIndex, 1);
      if (!this._slots.has(this.findSlotIndex(slot))) {
        return;
      }
      rendered.style.position = 'absolute';
      rendered.style.left = '0';
      rendered.style.top = '0';
      slot.contentDiv.replaceChildren(rendered);
    } catch (err) {
      logger.error('Failed to render page', err, {
        index: this.index,
        originalIndex,
      });
    }
  }

  private findSlotIndex(slot: PageSlot): number {
    for (const [idx, s] of this._slots) {
      if (s === slot) {
        return idx;
      }
    }
    return -1;
  }
}
