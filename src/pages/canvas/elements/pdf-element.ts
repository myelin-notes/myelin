import type * as Y from 'yjs';
import { loadDocument, type PdfDocument, renderPage } from '@/lib/pdf-renderer';
import type { CanvasViewport } from '../canvas-viewport';
import type { DrawableCanvas } from '../drawable-canvas';
import { bindYFields } from '../y-fields';
import { DrawableElement } from './drawable-element';
import { ElementType } from './element-type';

const PDF_PAGE_GAP = 40;

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
  action: HTMLDivElement | null;
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
  private _editing: boolean = false;

  private _frameDiv: HTMLDivElement | null = null;
  private _viewportDiv: HTMLDivElement | null = null;
  private _pageHost: HTMLDivElement | null = null;
  private _slots: Map<number, PageSlot> = new Map();

  constructor(index: number) {
    super(index, ElementType.PDF);
  }

  public override getYMapProps(): Record<string, unknown> {
    return {
      pageOrder: this._pageOrder as unknown,
      pageSizes: this._pageSizes as unknown,
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
      console.error('[pdf-element] failed to load document', err);
      this._pdfDocLoad = null;
    });
  }

  public setInitialPdfData(
    bytes: Uint8Array,
    pageSizes: PdfPageSize[],
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

    this.syncToYMap({
      pdfData: new Uint8Array(bytes),
      pageSizes: this._pageSizes as unknown,
      pageOrder: this._pageOrder as unknown,
    });
  }

  public get editing(): boolean {
    return this._editing;
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
    return new DOMRect(0, 0, this.totalWidth, this.totalHeight);
  }

  protected isOverLocal(
    x: number,
    y: number,
    _radius: number,
    _ctx: CanvasRenderingContext2D,
  ): boolean {
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

  public override get editable(): boolean {
    return true;
  }

  public override enterEditMode(
    canvas: DrawableCanvas,
    screenX?: number,
    screenY?: number,
  ): HTMLElement | null {
    this._editing = true;

    const sx = Math.abs(this._scale.x);
    const sy = Math.abs(this._scale.y);
    const firstPage = this.pageLayout()[0];
    const firstPageMiddle = firstPage
      ? this.offset.y + (firstPage.y + firstPage.h / 2) * sy
      : this.offset.y;
    const focusWorldY =
      screenX != null && screenY != null
        ? canvas.viewport.screenToWorld({ x: screenX, y: screenY }).y
        : firstPageMiddle;
    const focusRect = new DOMRect(
      this.offset.x,
      focusWorldY,
      this.totalWidth * sx,
      0,
    );
    canvas.viewport.animateViewToFitRect(focusRect, 0.65);

    return this._frameDiv;
  }

  public override exitEditMode(): void {
    this._editing = false;
  }

  public deletePage(orderIdx: number): void {
    if (orderIdx < 0 || orderIdx >= this._pageOrder.length) {
      return;
    }
    const nextOrder = this._pageOrder.slice();
    nextOrder.splice(orderIdx, 1);
    this.syncToYMap({
      pageOrder: nextOrder as unknown,
    });
    this._pageOrder = nextOrder;
  }

  public insertBlankAfter(orderIdx: number): void {
    if (this._pageOrder.length === 0) {
      return;
    }
    const neighborIdx = Math.max(
      0,
      Math.min(orderIdx, this._pageOrder.length - 1),
    );
    const { w, h } = entrySize(this._pageOrder[neighborIdx], this._pageSizes);
    const insertAt = neighborIdx + 1;
    const nextOrder = this._pageOrder.slice();
    nextOrder.splice(insertAt, 0, { kind: 'blank', w, h });
    this.syncToYMap({
      pageOrder: nextOrder as unknown,
    });
    this._pageOrder = nextOrder;
  }

  public override syncDOM(viewport: CanvasViewport, host: HTMLElement): void {
    this.ensurePdfDoc();

    if (!this._frameDiv) {
      this.createDom(host);
    }

    const frameDiv = this._frameDiv!;
    const viewportDiv = this._viewportDiv!;

    const zoom = viewport.zoom;
    const offset = viewport.offset;
    const dpr = window.devicePixelRatio || 1;
    const totalWidth = this.totalWidth;
    const totalHeight = this.totalHeight;

    const screenX = snapToDevicePixel((this.offset.x + offset.x) * zoom);
    const screenY = snapToDevicePixel((this.offset.y + offset.y) * zoom);
    frameDiv.style.width = `${totalWidth * zoom}px`;
    frameDiv.style.height = `${totalHeight * zoom}px`;
    frameDiv.style.transform = `translate(${screenX}px, ${screenY}px)`;
    frameDiv.style.pointerEvents = this._editing ? 'auto' : 'none';

    viewportDiv.style.width = `${totalWidth}px`;
    viewportDiv.style.height = `${totalHeight}px`;
    viewportDiv.style.zoom = `${dpr}`;
    viewportDiv.style.transform = `scale(${zoom / dpr})`;

    this.syncPages();
  }

  public override disposeDOM(): void {
    if (this._frameDiv) {
      this._frameDiv.remove();
    }
    this._frameDiv = null;
    this._viewportDiv = null;
    this._pageHost = null;
    this._slots.clear();
    this._pdfDoc?.destroy();
    this._pdfDoc = null;
  }

  private createDom(host: HTMLElement): void {
    const frameDiv = document.createElement('div');
    Object.assign(frameDiv.style, {
      position: 'absolute',
      left: '0px',
      top: '0px',
      transformOrigin: '0 0',
      overflow: 'visible',
    } as Partial<CSSStyleDeclaration>);
    frameDiv.dataset.elementIndex = String(this.index);
    frameDiv.dataset.elementType = 'pdf';

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
    host.appendChild(frameDiv);

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

      if (this._editing) {
        this.ensureActionStrip(slot, i);
      } else if (slot.action) {
        slot.action.remove();
        slot.action = null;
      }

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
    } as Partial<CSSStyleDeclaration>);
    div.dataset.pageKey = key;

    const contentDiv = document.createElement('div');
    Object.assign(contentDiv.style, {
      position: 'absolute',
      inset: '0',
    } as Partial<CSSStyleDeclaration>);
    div.appendChild(contentDiv);

    return { key, div, contentDiv, action: null };
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
      console.error('[pdf-element] render page failed', err);
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

  private ensureActionStrip(slot: PageSlot, orderIdx: number): void {
    if (slot.action) {
      return;
    }
    const action = document.createElement('div');
    Object.assign(action.style, {
      position: 'absolute',
      top: '8px',
      right: '8px',
      display: 'flex',
      gap: '6px',
      padding: '4px',
      borderRadius: '10px',
      background: 'rgba(255,255,255,0.92)',
      boxShadow: '0 1px 6px rgba(25,28,30,0.12)',
      backdropFilter: 'blur(16px)',
      zIndex: '3',
      pointerEvents: 'auto',
    } as Partial<CSSStyleDeclaration>);

    const deleteBtn = this.makeActionButton('Delete page', '×');
    deleteBtn.onclick = (e) => {
      e.stopPropagation();
      this.deletePage(orderIdx);
    };
    const addBtn = this.makeActionButton('Insert blank below', '+');
    addBtn.onclick = (e) => {
      e.stopPropagation();
      this.insertBlankAfter(orderIdx);
    };
    action.appendChild(addBtn);
    action.appendChild(deleteBtn);
    slot.div.appendChild(action);
    slot.action = action;
  }

  private makeActionButton(title: string, label: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.title = title;
    btn.textContent = label;
    Object.assign(btn.style, {
      width: '24px',
      height: '24px',
      border: 'none',
      borderRadius: '6px',
      background: 'rgba(25,28,30,0.06)',
      color: '#191c1e',
      fontSize: '14px',
      lineHeight: '1',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    } as Partial<CSSStyleDeclaration>);
    btn.onmouseenter = () => {
      btn.style.background = 'rgba(25,28,30,0.12)';
    };
    btn.onmouseleave = () => {
      btn.style.background = 'rgba(25,28,30,0.06)';
    };
    return btn;
  }
}
