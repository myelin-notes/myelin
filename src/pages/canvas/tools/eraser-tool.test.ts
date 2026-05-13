import { describe, expect, it, vi } from 'vitest';
import { catalogs } from '@/lib/i18n/messages';
import type { DrawableCanvas } from '../drawable-canvas';
import type { DrawableElement } from '../elements/drawable-element';
import { ElementType } from '../elements/element-type';
import { EraserTool } from './eraser-tool';

function makeElement(type: ElementType, over = true) {
  const isOver = vi.fn(() => over);
  const element = { type, isOver } as unknown as DrawableElement;
  return { element, isOver };
}

function makeCanvas(elements: DrawableElement[]) {
  const removeElement = vi.fn();
  const ctx = {} as CanvasRenderingContext2D;
  const canvas = {
    elements,
    ctx,
    removeElement,
  } as unknown as DrawableCanvas;

  return { canvas, ctx, removeElement };
}

describe('EraserTool', () => {
  it('erases only strokes under the cursor', () => {
    const stroke = makeElement(ElementType.STROKE);
    const text = makeElement(ElementType.TEXT);
    const image = makeElement(ElementType.IMAGE);
    const pageFrame = makeElement(ElementType.PAGE_FRAME);
    const pdf = makeElement(ElementType.PDF);
    const { canvas, ctx, removeElement } = makeCanvas([
      pageFrame.element,
      pdf.element,
      text.element,
      image.element,
      stroke.element,
    ]);

    new EraserTool(() => catalogs.en).update(canvas, {} as PointerEvent, {
      x: 10,
      y: 20,
    });

    expect(removeElement).toHaveBeenCalledTimes(1);
    expect(removeElement).toHaveBeenCalledWith(stroke.element);
    expect(stroke.isOver).toHaveBeenCalledWith(10, 20, 20, ctx);
    expect(text.isOver).not.toHaveBeenCalled();
    expect(image.isOver).not.toHaveBeenCalled();
    expect(pageFrame.isOver).not.toHaveBeenCalled();
    expect(pdf.isOver).not.toHaveBeenCalled();
  });

  it('leaves strokes outside the cursor untouched', () => {
    const stroke = makeElement(ElementType.STROKE, false);
    const { canvas, removeElement } = makeCanvas([stroke.element]);

    new EraserTool(() => catalogs.en).update(canvas, {} as PointerEvent, {
      x: 10,
      y: 20,
    });

    expect(removeElement).not.toHaveBeenCalled();
  });
});
