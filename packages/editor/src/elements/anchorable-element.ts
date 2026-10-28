import type * as Y from 'yjs';
import type { Vector2 } from '../geometry';
import { DrawableElement } from './drawable-element';
import { ElementType } from './element-type';

export interface PageFrameAnchor {
  kind?: never;
  frameId: string;
  /** Erased fragments share the original reservation until individually reanchored. */
  sharedGap?: { id: string; height: number };
  /** Encoded Yjs relative position; survives edits and deletion of adjacent text. */
  position: number[];
  /** Falls back to the block boundary if the containing paragraph is deleted. */
  blockPosition: number[];
  /** CSS pixels above the element inside its reserved gap; stable during dragging. */
  spaceBefore: number;
  /** World-space displacement from the resolved text position. */
  x: number;
  y: number;
}

/** Original PDF page index, or a blank page's id. */
export type PdfPageKey = number | string;

export interface PdfPageAnchor {
  kind: 'pdf';
  frameId: string;
  page: PdfPageKey;
  /** Offset from the page's top-left in the PDF's unscaled units, so it follows the PDF's scale. */
  x: number;
  y: number;
  /** Element scale relative to the PDF's. */
  scaleX: number;
  scaleY: number;
}

export type PageAnchor = PageFrameAnchor | PdfPageAnchor;

/** World position of an anchor's origin; `scale` (world units per anchor unit) is set for PDF anchors. */
export interface AnchorOrigin extends Vector2 {
  scale?: Vector2;
}

const UNIT_SCALE: Vector2 = { x: 1, y: 1 };

export abstract class AnchorableElement extends DrawableElement {
  private _pageAnchor: PageAnchor | null = null;
  private _makesSpace: boolean | undefined;
  public anchorOrigin: (() => AnchorOrigin | null) | null = null;

  public get pageAnchor(): PageAnchor | null {
    return this._pageAnchor;
  }

  public get makesSpace(): boolean {
    return this._makesSpace ?? this.type !== ElementType.STROKE;
  }

  public override get offset(): Vector2 {
    const anchor = this._pageAnchor;
    const origin = anchor && this.anchorOrigin?.();
    if (!anchor || !origin) {
      return super.offset;
    }
    const scale = origin.scale ?? UNIT_SCALE;
    return {
      x: origin.x + anchor.x * scale.x,
      y: origin.y + anchor.y * scale.y,
    };
  }

  public override get scale(): Vector2 {
    const anchor = this._pageAnchor;
    if (anchor?.kind === 'pdf') {
      const frameScale = this.anchorOrigin?.()?.scale;
      if (frameScale) {
        return {
          x: anchor.scaleX * frameScale.x,
          y: anchor.scaleY * frameScale.y,
        };
      }
    }
    return super.scale;
  }

  public override setOffset(x: number, y: number): void {
    const previous = this.offset;
    if (this._pageAnchor) {
      const scale = this.anchorOrigin?.()?.scale ?? UNIT_SCALE;
      this.setPageAnchor({
        ...this._pageAnchor,
        x: this._pageAnchor.x + (x - previous.x) / scale.x,
        y: this._pageAnchor.y + (y - previous.y) / scale.y,
      });
    }
    super.setOffset(x, y);
  }

  public override setScale(x: number, y: number): void {
    const anchor = this._pageAnchor;
    const frameScale =
      anchor?.kind === 'pdf' ? this.anchorOrigin?.()?.scale : undefined;
    if (anchor?.kind === 'pdf' && frameScale) {
      this.setPageAnchor({
        ...anchor,
        scaleX: x / frameScale.x,
        scaleY: y / frameScale.y,
      });
    }
    super.setScale(x, y);
  }

  public setPageAnchor(anchor: PageAnchor | null): void {
    const offset = this.offset;
    const scale = this.scale;
    const pdfAnchored = this._pageAnchor?.kind === 'pdf';
    this._pageAnchor = anchor;
    this.syncToYMap({ pageAnchor: anchor });
    if (!anchor) {
      super.setOffset(offset.x, offset.y);
      if (pdfAnchored) {
        super.setScale(scale.x, scale.y);
      }
    }
    this.onTransformChanged?.();
  }

  public setMakesSpace(value: boolean): void {
    this._makesSpace = value;
    this.syncToYMap({ makesSpace: value });
    this.onTransformChanged?.();
  }

  public override bindToYMap(yMap: Y.Map<unknown>): void {
    super.bindToYMap(yMap);
    this.bindYFields(yMap, {
      pageAnchor: (value) => {
        this._pageAnchor = value as PageAnchor | null;
      },
      makesSpace: (value) => {
        this._makesSpace = value as boolean;
      },
    });
  }

  public override syncFromYMap(keys: Iterable<string>): void {
    const changed = [...keys];
    super.syncFromYMap(changed);
    if (changed.includes('pageAnchor') && !this.yMap?.has('pageAnchor')) {
      this._pageAnchor = null;
    }
    if (changed.includes('makesSpace') && !this.yMap?.has('makesSpace')) {
      this._makesSpace = undefined;
    }
  }
}
