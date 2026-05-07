import type { RefObject } from 'react';
import type * as Y from 'yjs';
import type { FileId } from '@/lib/sync';
import type { DrawableCanvas } from '../drawable-canvas';
import { ElementType } from '../elements/element-type';
import { PageFrameElement } from '../elements/page-frame-element';
import {
  cloneYMap,
  copyXmlFragmentInto,
  openCanvasClipboardDocument,
} from './snapshot';
import type {
  CanvasClipboardPort,
  CanvasClipboardSelection,
  CanvasClipboardSnapshot,
  CanvasPasteContext,
  CanvasPastePlacement,
  CanvasPasteResult,
  CanvasRect,
} from './types';

function isBackgroundElement(type: ElementType): boolean {
  return type === ElementType.PAGE_FRAME || type === ElementType.PDF;
}

function rectFromDomRect(rect: DOMRect): CanvasRect {
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
  };
}

function unionRects(rects: CanvasRect[]): CanvasRect {
  const left = Math.min(...rects.map((rect) => rect.x));
  const top = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' ? value : fallback;
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

export class DrawableCanvasClipboardAdapter implements CanvasClipboardPort {
  public constructor(
    private readonly drawableCanvasRef: RefObject<DrawableCanvas | null>,
    private readonly noteId: FileId,
  ) {}

  private get canvas(): DrawableCanvas | null {
    return this.drawableCanvasRef.current;
  }

  public isEditing(): boolean {
    return Boolean(this.canvas?.editingElement);
  }

  public getSelection(): CanvasClipboardSelection | null {
    const canvas = this.canvas;
    if (!canvas) {
      return null;
    }

    const items = canvas.getSelectedElements().flatMap((element) => {
      if (!element.yMap) {
        return [];
      }

      return [
        {
          uuid: element.uuid,
          type: element.type,
          bounds: rectFromDomRect(element.boundingBox),
          yMap: element.yMap,
          pageFrameFragment:
            element instanceof PageFrameElement ? element.yXmlFragment : null,
        },
      ];
    });

    if (items.length === 0) {
      return null;
    }

    return {
      noteId: this.noteId,
      bounds: unionRects(items.map((item) => item.bounds)),
      items,
    };
  }

  public getPasteContext(): CanvasPasteContext | null {
    const canvas = this.canvas;
    if (!canvas) {
      return null;
    }

    const dpr = window.devicePixelRatio || 1;
    return {
      noteId: this.noteId,
      viewportCenter: canvas.viewport.screenToWorld({
        x: canvas.ctx.canvas.width / dpr / 2,
        y: canvas.ctx.canvas.height / dpr / 2,
      }),
    };
  }

  public deleteSelection(): void {
    this.canvas?.deleteSelected();
  }

  public pasteSnapshot(
    snapshot: CanvasClipboardSnapshot,
    placement: CanvasPastePlacement,
  ): CanvasPasteResult | null {
    const canvas = this.canvas;
    if (!canvas) {
      return null;
    }

    const clipboardDoc = openCanvasClipboardDocument(snapshot);
    const sourceMaps: Y.Map<unknown>[] = [];
    for (let i = 0; i < clipboardDoc.elements.length; i++) {
      sourceMaps.push(clipboardDoc.elements.get(i));
    }

    if (sourceMaps.length === 0) {
      return null;
    }

    const insertedUuids: string[] = [];
    let backgroundCursor = canvas.elements.filter((element) =>
      isBackgroundElement(element.type),
    ).length;

    canvas.ydoc.transact(() => {
      for (const sourceMap of sourceMaps) {
        const originalUuid = asString(sourceMap.get('uuid'));
        const nextMap = cloneYMap(sourceMap);
        const newUuid = crypto.randomUUID();

        nextMap.set('uuid', newUuid);
        nextMap.set(
          'offsetX',
          asNumber(sourceMap.get('offsetX')) + placement.translate.x,
        );
        nextMap.set(
          'offsetY',
          asNumber(sourceMap.get('offsetY')) + placement.translate.y,
        );

        const typeValue = sourceMap.get('type');
        const type =
          typeof typeValue === 'number'
            ? (typeValue as ElementType)
            : ElementType.STROKE;
        const background = isBackgroundElement(type);
        const element = canvas.insertElementMap(nextMap, {
          background,
          position: background ? backgroundCursor : undefined,
        });
        if (!element) {
          continue;
        }

        if (background) {
          backgroundCursor += 1;
        }

        if (type === ElementType.PAGE_FRAME && originalUuid) {
          copyXmlFragmentInto(
            canvas.ydoc.getXmlFragment(newUuid),
            clipboardDoc.getXmlFragment(originalUuid),
          );
        }

        insertedUuids.push(newUuid);
      }
    });

    if (insertedUuids.length === 0) {
      return null;
    }

    canvas.selectElementsByUuid(insertedUuids);
    canvas.updateBounding();
    return { pastedElementUuids: insertedUuids };
  }
}
