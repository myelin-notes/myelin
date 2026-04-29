import type * as Y from 'yjs';
import { Logger } from '@/lib/logger';
import { loadDocument, type PdfDocument, renderPage } from '@/lib/pdf-renderer';
import { fetchTile } from '@/lib/pdf-renderer/tile/fetcher';
import {
  TileManager,
  type ViewportInfo,
} from '@/lib/pdf-renderer/tile/manager';
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
// Cap tile rendering scale. dpr × MAX_TILE_SCALE_FACTOR sets the max device
// pixels per PDF point. 4 = good for ~2× zoom past pixel-perfect.
const MAX_TILE_SCALE_FACTOR = 4;
// Below this device-px-per-PDF-pt scale, the baseline canvas is already
// pixel-perfect and tiling adds no visual gain.
const MIN_TILE_SCALE = 2.5;
const logger = new Logger('PdfElement');

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
  /** Holds tile canvases positioned in % within the slot. */
  tileLayer: HTMLDivElement;
  /** Page index in pageLayout — needed to map slot → originalIndex. */
  layoutIndex: number;
  generation: number;
  rendered: boolean;
  pending: boolean;
  /** True once the tile manager's snapshot callback is registered. */
  tileSubscribed: boolean;
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
  private _tileManager: TileManager | null = null;
  private _currentViewport: CanvasViewport | null = null;
  private _currentLayout: ReturnType<typeof this.pageLayout> | null = null;

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

    this._currentViewport = viewport;
    const layout = this.pageLayout();
    this._currentLayout = layout;
    this.syncPages(viewport, layout);
    this.syncTiles(viewport, layout);
  }

  private ensureTileManager(): TileManager {
    if (!this._tileManager) {
      this._tileManager = new TileManager((pageIndex, tile, scale) => {
        const doc = this._pdfDoc;
        if (!doc) {
          return Promise.resolve(undefined);
        }
        return fetchTile(doc, pageIndex, tile, scale);
      });
      this._tileManager.setViewportSource(() => this.makeViewportInfo());
    }
    return this._tileManager;
  }

  private makeViewportInfo(): ViewportInfo | null {
    const viewport = this._currentViewport;
    const layout = this._currentLayout;
    if (!viewport || !layout) {
      return null;
    }
    const view = viewport.getWorldRect();
    const elOffX = this.offset.x;
    const elOffY = this.offset.y;
    const sX = this._scale.x;
    const sY = this._scale.y;
    return {
      pageViewport: (pageIndex: number) => {
        // Find the slot for this *originalIndex* (pdfjs page index).
        let layoutIdx = -1;
        for (let i = 0; i < layout.length; i++) {
          const e = layout[i].entry;
          if (e.kind === 'pdf' && e.originalIndex === pageIndex) {
            layoutIdx = i;
            break;
          }
        }
        if (layoutIdx < 0) {
          return null;
        }
        const page = layout[layoutIdx];
        // Page world bounds.
        const pageWorldX = elOffX;
        const pageWorldY = elOffY + page.y * sY;
        const pageWorldRight = pageWorldX + page.w * sX;
        const pageWorldBottom = pageWorldY + page.h * sY;
        // Intersect with view rect; transform to page-local PDF-pt coords.
        const ix = Math.max(view.left, pageWorldX);
        const iy = Math.max(view.top, pageWorldY);
        const ix2 = Math.min(view.right, pageWorldRight);
        const iy2 = Math.min(view.bottom, pageWorldBottom);
        if (ix >= ix2 || iy >= iy2) {
          return null;
        }
        return {
          x: (ix - pageWorldX) / sX,
          y: (iy - pageWorldY) / sY,
          width: (ix2 - ix) / sX,
          height: (iy2 - iy) / sY,
        };
      },
    };
  }

  private syncTiles(
    viewport: CanvasViewport,
    layout: ReturnType<typeof this.pageLayout>,
  ): void {
    if (!this._pdfDoc) {
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    const sX = this._scale.x;
    const sY = this._scale.y;
    const effectiveScale = viewport.zoom * Math.max(sX, sY) * dpr;
    const tileScale = Math.min(MAX_TILE_SCALE_FACTOR * dpr, effectiveScale);
    const enabled = tileScale >= MIN_TILE_SCALE && effectiveScale > dpr * 1.25;

    const mgr = this.ensureTileManager();

    for (const [layoutIdx, slot] of this._slots) {
      const entry = layout[layoutIdx]?.entry;
      if (!entry || entry.kind !== 'pdf') {
        continue;
      }
      const originalIndex = entry.originalIndex;
      if (!enabled || !slot.rendered) {
        if (slot.tileSubscribed) {
          mgr.removePage(originalIndex);
          mgr.setOnPageSnapshotChange(originalIndex, null);
          slot.tileLayer.replaceChildren();
          slot.tileSubscribed = false;
        }
        continue;
      }
      if (!slot.tileSubscribed) {
        mgr.setOnPageSnapshotChange(originalIndex, () => {
          const fresh = this._currentLayout;
          if (fresh) {
            this.repaintSlotTiles(slot, originalIndex, fresh);
          }
        });
        slot.tileSubscribed = true;
      }
      const page = layout[layoutIdx];
      mgr.setPageInputs(originalIndex, {
        pageWidth: page.w,
        pageHeight: page.h,
        scale: tileScale,
      });
    }
    mgr.refresh();
  }

  private repaintSlotTiles(
    slot: PageSlot,
    pageIndex: number,
    layout: ReturnType<typeof this.pageLayout>,
  ): void {
    const mgr = this._tileManager;
    if (!mgr) {
      return;
    }
    const tiles = mgr.getPageTiles(pageIndex);
    const page = layout[slot.layoutIndex];
    if (!page) {
      return;
    }
    const pageW = page.w;
    const pageH = page.h;
    if (tiles.length === 0) {
      slot.tileLayer.replaceChildren();
      return;
    }
    // Diff against existing children by data-tile-key so unchanged tiles
    // stay mounted (no flicker, no re-decode of the canvas).
    const existing = new Map<string, HTMLElement>();
    for (const child of Array.from(slot.tileLayer.children)) {
      const key = (child as HTMLElement).dataset.tileKey;
      if (key) {
        existing.set(key, child as HTMLElement);
      }
    }
    const fragment = document.createDocumentFragment();
    for (const tile of tiles) {
      const key = tile.descriptor.key;
      let host = existing.get(key);
      if (host) {
        existing.delete(key);
      } else {
        host = document.createElement('div');
        host.dataset.tileKey = key;
        host.style.position = 'absolute';
        host.style.left = `${(tile.descriptor.x / pageW) * 100}%`;
        host.style.top = `${(tile.descriptor.y / pageH) * 100}%`;
        host.style.width = `${(tile.descriptor.width / pageW) * 100}%`;
        host.style.height = `${(tile.descriptor.height / pageH) * 100}%`;
        host.style.willChange = 'transform';
        host.style.transform = 'translateZ(0)';
        const c = tile.canvas;
        c.style.width = '100%';
        c.style.height = '100%';
        c.style.display = 'block';
        host.appendChild(c);
      }
      fragment.appendChild(host);
    }
    for (const [, host] of existing) {
      host.remove();
    }
    slot.tileLayer.appendChild(fragment);
  }

  public override disposeDOM(): void {
    this._tileManager?.destroy();
    this._tileManager = null;
    this._currentViewport = null;
    this._currentLayout = null;
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

  private syncPages(
    viewport: CanvasViewport,
    layout: ReturnType<typeof this.pageLayout>,
  ): void {
    const pageHost = this._pageHost;
    if (!pageHost) {
      return;
    }
    const kept = new Set<number>();
    const visible = this.computeVisiblePages(viewport, layout);

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
        slot = this.createPageSlot(key, page.w, page.h, i);
        pageHost.appendChild(slot.div);
        this._slots.set(i, slot);
      } else {
        slot.layoutIndex = i;
      }

      slot.div.style.width = `${page.w}px`;
      slot.div.style.height = `${page.h}px`;
      slot.div.style.transform = `translate(0px, ${page.y}px)`;

      const wantRendered = visible.has(i) && page.entry.kind === 'pdf';
      if (wantRendered && !slot.rendered && !slot.pending) {
        slot.generation++;
        slot.pending = true;
        const originalIndex =
          page.entry.kind === 'pdf' ? page.entry.originalIndex : -1;
        if (originalIndex >= 0) {
          this.renderPdfPageInto(slot, originalIndex, slot.generation);
        }
      } else if (!wantRendered && (slot.rendered || slot.pending)) {
        slot.generation++;
        slot.rendered = false;
        slot.pending = false;
        slot.contentDiv.replaceChildren();
        slot.tileLayer.replaceChildren();
        if (
          slot.tileSubscribed &&
          page.entry.kind === 'pdf' &&
          this._tileManager
        ) {
          this._tileManager.removePage(page.entry.originalIndex);
          this._tileManager.setOnPageSnapshotChange(
            page.entry.originalIndex,
            null,
          );
          slot.tileSubscribed = false;
        }
      }

      kept.add(i);
    }

    for (const [idx, slot] of this._slots) {
      if (!kept.has(idx)) {
        slot.generation++;
        slot.div.remove();
        this._slots.delete(idx);
      }
    }
  }

  private computeVisiblePages(
    viewport: CanvasViewport,
    layout: ReturnType<typeof this.pageLayout>,
  ): Set<number> {
    const view = viewport.getWorldRect();
    // 1-viewport buffer beyond visible bounds: pre-render a screen ahead and
    // keep a screen behind so quick reverse pans don't flash blank.
    const marginX = view.width;
    const marginY = view.height;
    const visMinX = view.left - marginX;
    const visMaxX = view.right + marginX;
    const visMinY = view.top - marginY;
    const visMaxY = view.bottom + marginY;

    const elOffX = this.offset.x;
    const elOffY = this.offset.y;
    const sX = this._scale.x;
    const sY = this._scale.y;

    const out = new Set<number>();
    for (let i = 0; i < layout.length; i++) {
      const page = layout[i];
      const left = elOffX;
      const right = elOffX + page.w * sX;
      const top = elOffY + page.y * sY;
      const bottom = top + page.h * sY;
      if (
        right >= visMinX &&
        left <= visMaxX &&
        bottom >= visMinY &&
        top <= visMaxY
      ) {
        out.add(i);
      }
    }
    return out;
  }

  private createPageSlot(
    key: string,
    w: number,
    h: number,
    layoutIndex: number,
  ): PageSlot {
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

    const tileLayer = document.createElement('div');
    tileLayer.className = 'pdf-tile-layer';
    Object.assign(tileLayer.style, {
      position: 'absolute',
      inset: '0',
      overflow: 'hidden',
      pointerEvents: 'none',
    } as Partial<CSSStyleDeclaration>);

    return {
      key,
      div,
      contentDiv,
      tileLayer,
      layoutIndex,
      generation: 0,
      rendered: false,
      pending: false,
      tileSubscribed: false,
    };
  }

  private async renderPdfPageInto(
    slot: PageSlot,
    originalIndex: number,
    generation: number,
  ): Promise<void> {
    try {
      const doc = this._pdfDoc ?? (await this._pdfDocLoad);
      if (!doc || slot.generation !== generation) {
        return;
      }
      const rendered = await renderPage(doc, originalIndex, 1);
      if (slot.generation !== generation) {
        return;
      }
      rendered.style.position = 'absolute';
      rendered.style.left = '0';
      rendered.style.top = '0';
      // Insert tile layer above the baseline canvas so tiles overlay the
      // baseline raster as they arrive.
      const baselineCanvas = rendered.querySelector('canvas');
      if (baselineCanvas?.nextSibling) {
        rendered.insertBefore(slot.tileLayer, baselineCanvas.nextSibling);
      } else {
        rendered.appendChild(slot.tileLayer);
      }
      slot.contentDiv.replaceChildren(rendered);
      slot.rendered = true;
    } catch (err) {
      logger.error('Failed to render page', err, {
        index: this.index,
        originalIndex,
      });
    } finally {
      if (slot.generation === generation) {
        slot.pending = false;
      }
    }
  }
}
