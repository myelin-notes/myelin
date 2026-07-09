import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DrawableCanvas, Vector2 } from '../drawable-canvas';
import { ElementType } from '../elements/element-type';
import { ImageElement } from '../elements/image-element';
import { catalogs } from '../i18n/messages';
import { YDocManager } from '../ydoc-manager';
import { SelectTool } from './select-tool';

class TestDOMRect {
  constructor(
    public x = 0,
    public y = 0,
    public width = 0,
    public height = 0,
  ) {}

  get left() {
    return Math.min(this.x, this.x + this.width);
  }

  get right() {
    return Math.max(this.x, this.x + this.width);
  }

  get top() {
    return Math.min(this.y, this.y + this.height);
  }

  get bottom() {
    return Math.max(this.y, this.y + this.height);
  }
}

function makeImageElement() {
  vi.stubGlobal('DOMRect', TestDOMRect);
  const ydoc = new YDocManager();
  const yMap = ydoc.createElementMap(ElementType.IMAGE, 'image-uuid', {
    offsetX: 0,
    offsetY: 0,
    scaleX: 1,
    scaleY: 1,
    naturalWidth: 100,
    naturalHeight: 80,
    cropX: 0,
    cropY: 0,
    cropW: 100,
    cropH: 80,
  });
  const image = new ImageElement('image-uuid');
  image.bindToYMap(yMap);
  (image as unknown as { _bitmap: ImageBitmap | null })._bitmap =
    {} as ImageBitmap;
  return { image, ydoc };
}

function makeCanvas(elements: ImageElement[], point: Vector2) {
  const enterElementEdit = vi.fn();
  const canvas = {
    elements,
    enterElementEdit,
    viewport: {
      getPoint: vi.fn(() => point),
    },
  } as unknown as DrawableCanvas;
  enterElementEdit.mockImplementation((element: ImageElement) => {
    element.enterEditMode(canvas);
  });

  return { canvas, enterElementEdit };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('SelectTool', () => {
  it('enters image crop mode on double-click', () => {
    const { image } = makeImageElement();
    const enterCropMode = vi
      .spyOn(image, 'enterCropMode')
      .mockImplementation(() => {});
    const { canvas, enterElementEdit } = makeCanvas([image], { x: 10, y: 10 });
    const tool = new SelectTool(() => catalogs.en);
    const event = {} as PointerEvent;
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(1100);

    tool.start(canvas, event);
    tool.finish(canvas, event);
    tool.start(canvas, event);

    expect(image.isSelected).toBe(true);
    expect(enterCropMode).toHaveBeenCalledTimes(1);
    expect(enterElementEdit).toHaveBeenCalledWith(image, event);
  });

  it('does not enter image crop mode on a single click of a selected image', () => {
    const { image } = makeImageElement();
    image.select();
    const enterCropMode = vi
      .spyOn(image, 'enterCropMode')
      .mockImplementation(() => {});
    const { canvas, enterElementEdit } = makeCanvas([image], { x: 10, y: 10 });
    const tool = new SelectTool(() => catalogs.en);
    const event = {} as PointerEvent;

    tool.start(canvas, event);
    tool.finish(canvas, event);

    expect(enterCropMode).not.toHaveBeenCalled();
    expect(enterElementEdit).not.toHaveBeenCalled();
  });

  it('does not write element position when clicking to select without moving', () => {
    const { image, ydoc } = makeImageElement();
    const updates = vi.fn();
    ydoc.doc.on('update', updates);
    const point = { x: 10, y: 10 };
    const { canvas } = makeCanvas([image], point);
    const tool = new SelectTool(() => catalogs.en);
    const event = {} as PointerEvent;

    tool.start(canvas, event);
    tool.update(canvas, event, point);
    tool.finish(canvas, event);

    expect(image.isSelected).toBe(true);
    expect(image.offset).toEqual({ x: 0, y: 0 });
    expect(updates).not.toHaveBeenCalled();
  });
});
