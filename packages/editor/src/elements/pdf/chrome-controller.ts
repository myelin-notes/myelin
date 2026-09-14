import type { CanvasViewport } from '../../canvas-viewport';
import { PAGE_GAP, type PageLayout } from '../page-frame-constants';
import {
  createPdfChromeButton,
  type PdfChromeButtonHandle,
} from './chrome-button';
import {
  isPdfLayoutVisible,
  isPdfPageVisible,
  PDF_PAGE_RENDER_MARGIN,
  type PdfLayout,
} from './layout';

const GAP_BUTTON_SIZE = 24;
const DELETE_BUTTON_SIZE = 24;
const DELETE_BUTTON_OFFSET = 16;
const MIN_CHROME_BUTTON_PIXEL_SIZE = 18;

export class PdfChromeController {
  private readonly gapButtons = new Map<number, PdfChromeButtonHandle>();
  private readonly deleteButtons = new Map<number, PdfChromeButtonHandle>();

  public constructor(
    private readonly getControlsLayer: () => HTMLElement | null,
    private readonly onInsertBlankPage: (position: number) => void,
    private readonly onDeletePage: (position: number) => void,
  ) {}

  public sync(params: {
    viewport: CanvasViewport;
    zoom: number;
    offset: { x: number; y: number };
    scaleX: number;
    scaleY: number;
    pageLayout: PageLayout;
    layout: PdfLayout;
  }): void {
    this.syncGapButtons(params);
    this.syncDeleteButtons(params);
  }

  public setZIndex(zIndex: string): void {
    for (const button of this.gapButtons.values()) {
      if (button.root.style.zIndex !== zIndex) {
        button.root.style.zIndex = zIndex;
      }
    }
    for (const button of this.deleteButtons.values()) {
      if (button.root.style.zIndex !== zIndex) {
        button.root.style.zIndex = zIndex;
      }
    }
  }

  public clear(): void {
    this.removeAllGapButtons();
    this.removeAllDeleteButtons();
  }

  private syncGapButtons(params: {
    viewport: CanvasViewport;
    zoom: number;
    offset: { x: number; y: number };
    scaleX: number;
    scaleY: number;
    pageLayout: PageLayout;
    layout: PdfLayout;
  }): void {
    const activePositions = new Set<number>();
    const worldRect = params.viewport.getWorldRect();
    if (
      params.layout.pages.length < 1 ||
      !isPdfLayoutVisible({
        worldRect,
        offset: params.offset,
        scaleX: params.scaleX,
        scaleY: params.scaleY,
        layout: params.layout,
      })
    ) {
      this.removeInactiveGapButtons(activePositions);
      return;
    }

    for (
      let insertPosition = 0;
      insertPosition <= params.layout.pages.length;
      insertPosition++
    ) {
      const { localX, localY } = this.getGapPosition(
        insertPosition,
        params.pageLayout,
        params.layout,
      );
      const worldX = params.offset.x + localX * params.scaleX;
      const worldY = params.offset.y + localY * params.scaleY;
      const outsideView =
        params.pageLayout === 'horizontal'
          ? worldX < worldRect.left - PDF_PAGE_RENDER_MARGIN ||
            worldX > worldRect.right + PDF_PAGE_RENDER_MARGIN
          : worldY < worldRect.top - PDF_PAGE_RENDER_MARGIN ||
            worldY > worldRect.bottom + PDF_PAGE_RENDER_MARGIN;
      if (outsideView) {
        continue;
      }
      const button = this.getGapButton(insertPosition);
      this.attach(button);
      activePositions.add(insertPosition);
      const size = Math.max(
        MIN_CHROME_BUTTON_PIXEL_SIZE,
        GAP_BUTTON_SIZE * params.zoom,
      );
      button.sync({
        screenX: snapToDevicePixel(
          (params.offset.x +
            params.viewport.offset.x +
            localX * params.scaleX) *
            params.zoom,
        ),
        screenY: snapToDevicePixel(
          (params.offset.y +
            params.viewport.offset.y +
            localY * params.scaleY) *
            params.zoom,
        ),
        size,
      });
    }
    this.removeInactiveGapButtons(activePositions);
  }

  private syncDeleteButtons(params: {
    viewport: CanvasViewport;
    zoom: number;
    offset: { x: number; y: number };
    scaleX: number;
    scaleY: number;
    pageLayout: PageLayout;
    layout: PdfLayout;
  }): void {
    const activePositions = new Set<number>();
    const worldRect = params.viewport.getWorldRect();
    if (
      params.layout.pages.length < 2 ||
      !isPdfLayoutVisible({
        worldRect,
        offset: params.offset,
        scaleX: params.scaleX,
        scaleY: params.scaleY,
        layout: params.layout,
      })
    ) {
      this.removeInactiveDeleteButtons(activePositions);
      return;
    }
    for (const [pagePosition, page] of params.layout.pages.entries()) {
      if (
        !isPdfPageVisible({
          worldRect,
          offset: params.offset,
          localLeft: page.localLeft,
          localTop: page.localTop,
          pageSize: page.size,
          scaleX: params.scaleX,
          scaleY: params.scaleY,
          verticalMargin: PDF_PAGE_RENDER_MARGIN,
        })
      ) {
        continue;
      }
      const button = this.getDeleteButton(pagePosition);
      this.attach(button);
      activePositions.add(pagePosition);
      const size = Math.max(
        MIN_CHROME_BUTTON_PIXEL_SIZE,
        DELETE_BUTTON_SIZE * params.zoom,
      );
      button.sync({
        screenX: snapToDevicePixel(
          (params.offset.x +
            params.viewport.offset.x +
            (page.localLeft + page.size.w - DELETE_BUTTON_OFFSET) *
              params.scaleX) *
            params.zoom,
        ),
        screenY: snapToDevicePixel(
          (params.offset.y +
            params.viewport.offset.y +
            (page.localTop + DELETE_BUTTON_OFFSET) * params.scaleY) *
            params.zoom,
        ),
        size,
      });
    }
    this.removeInactiveDeleteButtons(activePositions);
  }

  private getGapPosition(
    position: number,
    pageLayout: PageLayout,
    layout: PdfLayout,
  ): { localX: number; localY: number } {
    if (pageLayout === 'horizontal') {
      const page = layout.pages[position] ?? layout.pages.at(-1)!;
      return {
        localX:
          position < layout.pages.length
            ? page.localLeft - PAGE_GAP / 2
            : page.localLeft + page.size.w + PAGE_GAP / 2,
        localY: layout.totalHeight / 2,
      };
    }
    const page = layout.pages[position] ?? layout.pages.at(-1)!;
    return {
      localX: layout.totalWidth / 2,
      localY:
        position < layout.pages.length
          ? page.localTop - PAGE_GAP / 2
          : page.localTop + page.size.h + PAGE_GAP / 2,
    };
  }

  private getGapButton(position: number): PdfChromeButtonHandle {
    let button = this.gapButtons.get(position);
    if (!button) {
      button = createPdfChromeButton({
        kind: 'add',
        onPress: () => this.onInsertBlankPage(position),
      });
      this.gapButtons.set(position, button);
    }
    return button;
  }

  private getDeleteButton(position: number): PdfChromeButtonHandle {
    let button = this.deleteButtons.get(position);
    if (!button) {
      button = createPdfChromeButton({
        kind: 'delete',
        onPress: () => this.onDeletePage(position),
      });
      this.deleteButtons.set(position, button);
    }
    return button;
  }

  private attach(button: PdfChromeButtonHandle): void {
    if (!button.root.isConnected) {
      this.getControlsLayer()?.appendChild(button.root);
    }
  }

  private removeInactiveGapButtons(activePositions: Set<number>): void {
    for (const [position, button] of this.gapButtons) {
      if (!activePositions.has(position)) {
        button.dispose();
        this.gapButtons.delete(position);
      }
    }
  }

  private removeInactiveDeleteButtons(activePositions: Set<number>): void {
    for (const [position, button] of this.deleteButtons) {
      if (!activePositions.has(position)) {
        button.dispose();
        this.deleteButtons.delete(position);
      }
    }
  }

  private removeAllGapButtons(): void {
    for (const button of this.gapButtons.values()) {
      button.dispose();
    }
    this.gapButtons.clear();
  }

  private removeAllDeleteButtons(): void {
    for (const button of this.deleteButtons.values()) {
      button.dispose();
    }
    this.deleteButtons.clear();
  }
}

function snapToDevicePixel(value: number): number {
  const dpr = window.devicePixelRatio || 1;
  return Math.round(value * dpr) / dpr;
}
