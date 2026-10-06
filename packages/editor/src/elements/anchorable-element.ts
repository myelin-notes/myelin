import type * as Y from 'yjs';
import type { Vector2 } from '../geometry';
import { DrawableElement } from './drawable-element';
import { ElementType } from './element-type';

export interface PageFrameAnchor {
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

export abstract class AnchorableElement extends DrawableElement {
  private _pageAnchor: PageFrameAnchor | null = null;
  private _makesSpace: boolean | undefined;
  public anchorOrigin: (() => Vector2 | null) | null = null;

  public get pageAnchor(): PageFrameAnchor | null {
    return this._pageAnchor;
  }

  public get makesSpace(): boolean {
    return this._makesSpace ?? this.type !== ElementType.STROKE;
  }

  public override get offset(): Vector2 {
    const anchor = this._pageAnchor;
    const origin = anchor && this.anchorOrigin?.();
    return anchor && origin
      ? { x: origin.x + anchor.x, y: origin.y + anchor.y }
      : super.offset;
  }

  public override setOffset(x: number, y: number): void {
    const previous = this.offset;
    if (this._pageAnchor) {
      this.setPageAnchor({
        ...this._pageAnchor,
        x: this._pageAnchor.x + x - previous.x,
        y: this._pageAnchor.y + y - previous.y,
      });
    }
    super.setOffset(x, y);
  }

  public setPageAnchor(anchor: PageFrameAnchor | null): void {
    const offset = this.offset;
    this._pageAnchor = anchor;
    this.syncToYMap({ pageAnchor: anchor });
    if (!anchor) {
      super.setOffset(offset.x, offset.y);
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
        this._pageAnchor = value as PageFrameAnchor | null;
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
