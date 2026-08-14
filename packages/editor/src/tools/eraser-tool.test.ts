import { describe, expect, it, vi } from 'vitest';
import type { DrawableCanvas } from '../drawable-canvas';
import type { DrawableElement } from '../elements/drawable-element';
import { ElementType } from '../elements/element-type';
import { catalogs } from '../i18n/messages';
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
  it('erases only strokes and shapes under the cursor', () => {
    const stroke = makeElement(ElementType.STROKE);
    const shape = makeElement(ElementType.SHAPE);
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
      shape.element,
    ]);

    new EraserTool(() => catalogs.en).update(canvas, {} as PointerEvent, {
      x: 10,
      y: 20,
    });

    expect(removeElement).toHaveBeenCalledTimes(2);
    expect(removeElement).toHaveBeenCalledWith(stroke.element);
    expect(removeElement).toHaveBeenCalledWith(shape.element);
    expect(stroke.isOver).toHaveBeenCalledWith(10, 20, 20, ctx);
    expect(shape.isOver).toHaveBeenCalledWith(10, 20, 20, ctx);
    expect(text.isOver).not.toHaveBeenCalled();
    expect(image.isOver).not.toHaveBeenCalled();
    expect(pageFrame.isOver).not.toHaveBeenCalled();
    expect(pdf.isOver).not.toHaveBeenCalled();
  });

  it('leaves strokes and shapes outside the cursor untouched', () => {
    const stroke = makeElement(ElementType.STROKE, false);
    const shape = makeElement(ElementType.SHAPE, false);
    const { canvas, removeElement } = makeCanvas([
      stroke.element,
      shape.element,
    ]);

    new EraserTool(() => catalogs.en).update(canvas, {} as PointerEvent, {
      x: 10,
      y: 20,
    });

    expect(removeElement).not.toHaveBeenCalled();
  });
});
