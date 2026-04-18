import { Selection } from 'prosemirror-state';
import type * as Y from 'yjs';
import type { DrawableCanvas } from '../drawable-canvas';
import { PageFrameEditorState } from '../page-frame/pm/pm-editor-state';
import { bindYFields } from '../y-fields';
import { DrawableElement } from './drawable-element';
import { ElementType } from './element-type';
import {
  CHROME_BOTTOM_PADDING,
  CHROME_HEADER_HEIGHT,
  CHROME_SIDE_PADDING,
} from './frame-chrome';

export const PAGE_WIDTH = 680;
export const PAGE_HEIGHT = 880;
export const PAGE_PADDING = 48;
export const PAGE_GAP = 40;
export const PAGE_CORNER_RADIUS = 3;

export class PageFrameElement extends DrawableElement {
  private _pageWidth = PAGE_WIDTH;
  private _pageHeight = PAGE_HEIGHT;
  private _editing = false;
  private _numPages = 1;

  /** Set externally by DrawableCanvas after binding to Y.Doc. */
  private _yXmlFragment: Y.XmlFragment | null = null;
  public pmEditor: PageFrameEditorState | null = null;

  private _frameDiv: HTMLDivElement | null = null;
  private _contentDiv: HTMLDivElement | null = null;

  public get frameDiv(): HTMLDivElement | null {
    return this._frameDiv;
  }
  public get contentDiv(): HTMLDivElement | null {
    return this._contentDiv;
  }

  public mountDOM(frameDiv: HTMLDivElement, contentDiv: HTMLDivElement): void {
    this._frameDiv = frameDiv;
    this._contentDiv = contentDiv;
  }

  constructor(index: number) {
    super(index, ElementType.PAGE_FRAME);
  }

  public override getYMapProps(): Record<string, unknown> {
    return {
      pageWidth: this._pageWidth,
      pageHeight: this._pageHeight,
    };
  }

  /** Bind Yjs shared types. Must be called after bindToYMap. */
  public bindYProseMirror(yXmlFragment: Y.XmlFragment): void {
    this._yXmlFragment = yXmlFragment;
    this.pmEditor = new PageFrameEditorState(yXmlFragment);
  }

  public get yXmlFragment(): Y.XmlFragment | null {
    return this._yXmlFragment;
  }

  public override bindToYMap(yMap: Y.Map<unknown>): void {
    super.bindToYMap(yMap);
    bindYFields(yMap, {
      pageWidth: (v) => {
        this._pageWidth = v as number;
      },
      pageHeight: (v) => {
        this._pageHeight = v as number;
      },
    });
  }

  public get editing(): boolean {
    return this._editing;
  }
  public get pageWidth(): number {
    return this._pageWidth;
  }
  public get pageHeight(): number {
    return this._pageHeight;
  }
  public get numPages(): number {
    return this._numPages;
  }
  public set numPages(n: number) {
    this._numPages = n;
  }

  public get totalHeight(): number {
    const n = this._numPages;
    return n * this._pageHeight + Math.max(0, n - 1) * PAGE_GAP;
  }

  public get localBoundingBox(): DOMRect {
    return new DOMRect(
      -CHROME_SIDE_PADDING,
      -CHROME_HEADER_HEIGHT,
      this._pageWidth + CHROME_SIDE_PADDING * 2,
      this.totalHeight + CHROME_HEADER_HEIGHT + CHROME_BOTTOM_PADDING,
    );
  }

  protected isOverLocal(
    x: number,
    y: number,
    _radius: number,
    _ctx: CanvasRenderingContext2D,
  ): boolean {
    // Chrome (surrounding frame + header) hit area
    if (
      x >= -CHROME_SIDE_PADDING &&
      x <= this._pageWidth + CHROME_SIDE_PADDING &&
      y >= -CHROME_HEADER_HEIGHT &&
      y <= this.totalHeight + CHROME_BOTTOM_PADDING
    ) {
      return true;
    }
    if (x < 0 || x > this._pageWidth) {
      return false;
    }
    for (let p = 0; p < this._numPages; p++) {
      const pageTop = p * (this._pageHeight + PAGE_GAP);
      if (y >= pageTop && y <= pageTop + this._pageHeight) {
        return true;
      }
    }
    return false;
  }

  protected updateBoundingBox(): void {}

  public override get editable(): boolean {
    return true;
  }

  public override enterEditMode(
    canvas: DrawableCanvas,
    screenX?: number,
    screenY?: number,
  ): HTMLElement | null {
    this._editing = true;
    this.pmEditor?.setEditable(true);

    // Horizontally: center the page (zoom fits page width to 65% of viewport).
    // Vertically: center on the click's world Y so the user lands on exactly
    // the line they tapped. Fall back to the first page's middle when entered
    // with no pointer location.
    const sx = Math.abs(this._scale.x);
    const sy = Math.abs(this._scale.y);
    const focusWorldY =
      screenX != null && screenY != null
        ? canvas.viewport.screenToWorld({ x: screenX, y: screenY }).y
        : this.offset.y + (this._pageHeight * sy) / 2;
    // Zero-height rect: animateViewToFitRect uses width for zoom and the
    // rect's center as the focal point, so a 0-height rect at focusWorldY
    // gives us "fit page width, vertical center = focusWorldY".
    const focusRect = new DOMRect(
      this.offset.x,
      focusWorldY,
      this._pageWidth * sx,
      0,
    );
    canvas.viewport.animateViewToFitRect(focusRect, 0.65);

    const view = this.pmEditor?.view;
    if (view) {
      // Resolve click position BEFORE focus — focus may scroll the
      // container, which would invalidate the viewport coordinates.
      let pos: number | null = null;
      if (screenX != null && screenY != null) {
        const coords = view.posAtCoords({ left: screenX, top: screenY });
        if (coords) {
          pos = coords.pos;
        }
      }
      if (pos == null) {
        pos = view.state.doc.content.size - 1;
      }

      view.focus();
      const tr = view.state.tr.setSelection(
        Selection.near(view.state.doc.resolve(pos)),
      );
      view.dispatch(tr);
    }

    return this.frameDiv;
  }

  public override exitEditMode(): void {
    this._editing = false;
    this.pmEditor?.setEditable(false);
    this.pmEditor?.blur();
    // Yjs UndoManager captures PM changes automatically — no snapshot needed
  }

  protected draw2D(_ctx: CanvasRenderingContext2D, _deltaTime: number): void {}
}
