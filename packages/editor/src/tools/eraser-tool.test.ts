import { describe, expect, it, vi } from 'vitest';
import type { DrawableCanvas } from '../drawable-canvas';
import type { DrawableElement } from '../elements/drawable-element';
import { ElementType } from '../elements/element-type';
import { StrokeElement } from '../elements/stroke-element';
import { catalogs } from '../i18n/messages';
import { EraserTool } from './eraser-tool';

function makeElement(type: ElementType, over = true) {
  const isOver = vi.fn(() => over);
  const element = { type, isOver } as unknown as DrawableElement;
  return { element, isOver };
}

function makeCanvas(elements: DrawableElement[]) {
  let nextUuid = 1;
  const removeElement = vi.fn((element: DrawableElement) => {
    const index = elements.indexOf(element);
    if (index >= 0) {
      elements.splice(index, 1);
    }
  });
  const addElement = vi.fn(
    (
      factory: (uuid: string) => DrawableElement,
      position = elements.length,
    ) => {
      const element = factory(`new-${nextUuid++}`);
      elements.splice(position, 0, element);
      return element;
    },
  );
  const transact = vi.fn((fn: () => void) => fn());
  const ctx = {} as CanvasRenderingContext2D;
  const canvas = {
    elements,
    ctx,
    addElement,
    removeElement,
    transact,
  } as unknown as DrawableCanvas;

  return { canvas, ctx, addElement, removeElement, transact };
}

function usePreciseMode(tool: EraserTool, radius = 5): void {
  for (const option of tool.getOptions()) {
    if (option.type === 'choice' && option.key === 'eraserStyle') {
      option.set('precise');
    }
    if (option.type === 'size' && option.key === 'size') {
      option.set(radius);
    }
  }
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

  it('splits a stroke at erased points and keeps the first run as the original', () => {
    const stroke = new StrokeElement(
      'original',
      [0, 0, 0.1, 10, 0, 0.2, 20, 0, 0.3, 30, 0, 0.4, 40, 0, 0.5],
      true,
      { color: '#123456', size: 2 },
    );
    stroke.setOffset(100, 50);
    stroke.setScale(2, 2);
    const elements: DrawableElement[] = [stroke];
    const { canvas, addElement, removeElement, transact } =
      makeCanvas(elements);
    const tool = new EraserTool(() => catalogs.en);
    usePreciseMode(tool);

    tool.update(canvas, {} as PointerEvent, { x: 120, y: 50 });

    expect(elements).toHaveLength(2);
    expect(elements[0]).toBe(stroke);
    expect(stroke.uuid).toBe('original');
    expect(stroke.xyPoints).toEqual([[0, 0]]);

    const second = elements[1] as StrokeElement;
    expect(second.uuid).toBe('new-1');
    expect(second.xyPoints).toEqual([
      [20, 0],
      [30, 0],
      [40, 0],
    ]);
    expect(second.strokeStyle).toEqual(stroke.strokeStyle);
    expect(second.pressureEnabled).toBe(true);
    expect(second.offset).toEqual({ x: 100, y: 50 });
    expect(second.scale).toEqual({ x: 2, y: 2 });
    expect(addElement).toHaveBeenCalledWith(expect.any(Function), 1);
    expect(removeElement).not.toHaveBeenCalled();
    expect(transact).toHaveBeenCalledTimes(1);
  });

  it('keeps the only surviving run on the original stroke', () => {
    const stroke = new StrokeElement(
      'original',
      [0, 0, 0.5, 10, 0, 0.5, 20, 0, 0.5],
      false,
      { color: '#123456', size: 2 },
    );
    const elements: DrawableElement[] = [stroke];
    const { canvas, addElement, removeElement } = makeCanvas(elements);
    const tool = new EraserTool(() => catalogs.en);
    usePreciseMode(tool);

    tool.update(canvas, {} as PointerEvent, { x: 0, y: 0 });

    expect(elements).toEqual([stroke]);
    expect(stroke.xyPoints).toEqual([
      [10, 0],
      [20, 0],
    ]);
    expect(addElement).not.toHaveBeenCalled();
    expect(removeElement).not.toHaveBeenCalled();
  });

  it('removes a stroke when precise erasing leaves no points', () => {
    const stroke = new StrokeElement('original', [0, 0, 0.5], false, {
      color: '#123456',
      size: 2,
    });
    const elements: DrawableElement[] = [stroke];
    const { canvas, addElement, removeElement } = makeCanvas(elements);
    const tool = new EraserTool(() => catalogs.en);
    usePreciseMode(tool);

    tool.update(canvas, {} as PointerEvent, { x: 0, y: 0 });

    expect(elements).toEqual([]);
    expect(removeElement).toHaveBeenCalledWith(stroke);
    expect(addElement).not.toHaveBeenCalled();
  });
});
