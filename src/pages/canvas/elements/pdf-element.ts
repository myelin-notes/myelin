import type * as Y from 'yjs';
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
import { PAGE_HEIGHT, PAGE_WIDTH } from './page-frame-constants';

function snapToDevicePixel(value: number): number {
  const dpr = window.devicePixelRatio || 1;
  return Math.round(value * dpr) / dpr;
}

export class PdfElement extends DrawableElement {
  private _pdfBytes: Uint8Array | null = null;
  private _fileName: string = '';
  private _chrome: FrameChrome | null = null;

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
      pageSizes: [{ w: PAGE_WIDTH, h: PAGE_HEIGHT }],
      pageOrder: [{ kind: 'pdf', originalIndex: 0 }],
    };

    if (this._pdfBytes) {
      props.pdfData = new Uint8Array(this._pdfBytes);
    }

    return props;
  }

  public override bindToYMap(yMap: Y.Map<unknown>): void {
    super.bindToYMap(yMap);
    bindYFields(yMap, {
      pdfData: (v) => {
        this._pdfBytes = new Uint8Array(v as Uint8Array);
      },
      fileName: (v) => {
        this._fileName = (v as string) ?? '';
        this._chrome?.setFileName(this._fileName || null);
      },
    });
  }

  public setInitialPdfData(bytes: Uint8Array, fileName: string): void {
    this._pdfBytes = bytes;
    this._fileName = fileName;
    this._chrome?.setFileName(fileName || null);

    this.syncToYMap({
      pdfData: new Uint8Array(bytes),
      pageSizes: [{ w: PAGE_WIDTH, h: PAGE_HEIGHT }],
      pageOrder: [{ kind: 'pdf', originalIndex: 0 }],
      fileName,
    });
  }

  public get fileName(): string {
    return this._fileName;
  }

  public getMenuItems(): ChromeMenuItem[] {
    return [];
  }

  public get totalWidth(): number {
    return PAGE_WIDTH;
  }

  public get totalHeight(): number {
    return PAGE_HEIGHT;
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
    const screenX = snapToDevicePixel((this.offset.x + offset.x) * zoom);
    const screenY = snapToDevicePixel((this.offset.y + offset.y) * zoom);

    this._chrome?.sync({
      screenX,
      screenY,
      contentWidth: this.totalWidth * this._scale.x,
      contentHeight: this.totalHeight * this._scale.y,
      zoom,
    });
  }

  public override disposeDOM(): void {
    this._chrome?.dispose();
    this._chrome = null;
  }

  private createDom(host: HTMLElement): void {
    const chrome = new FrameChrome({
      kindLabel: 'PDF',
      getMenuItems: () => this.getMenuItems(),
    });
    chrome.setFileName(this._fileName || null);
    chrome.root.dataset.elementIndex = String(this.index);
    chrome.root.dataset.elementType = 'pdf';
    host.appendChild(chrome.root);
    this._chrome = chrome;
  }
}
