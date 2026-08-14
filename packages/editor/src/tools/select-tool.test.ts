import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DrawableCanvas, Vector2 } from '../drawable-canvas';
import type { DrawableElement } from '../elements/drawable-element';
import { ElementType } from '../elements/element-type';
import { ImageElement } from '../elements/image-element';
import { PAGE_HEIGHT, PAGE_WIDTH } from '../elements/page-frame-constants';
import { PageFrameElement } from '../elements/page-frame-element';
import { catalogs } from '../i18n/messages';
import { CollisionHelper } from '../utils/collision-helper';
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

function makeImageElement(uuid = 'image-uuid', offsetX = 0, offsetY = 0) {
  vi.stubGlobal('DOMRect', TestDOMRect);
  const ydoc = new YDocManager();
  const yMap = ydoc.createElementMap(ElementType.IMAGE, uuid, {
    offsetX,
    offsetY,
    scaleX: 1,
    scaleY: 1,
    naturalWidth: 100,
    naturalHeight: 80,
    cropX: 0,
    cropY: 0,
    cropW: 100,
    cropH: 80,
  });
  const image = new ImageElement(uuid);
  image.bindToYMap(yMap);
  (image as unknown as { _bitmap: ImageBitmap | null })._bitmap =
    {} as ImageBitmap;
  return { image, ydoc };
}

function makePageFrame(uuid = 'frame-uuid', offsetX = 0, offsetY = 0) {
  vi.stubGlobal('DOMRect', TestDOMRect);
  const ydoc = new YDocManager();
  const yMap = ydoc.createElementMap(ElementType.PAGE_FRAME, uuid, {
    offsetX,
    offsetY,
    scaleX: 1,
    scaleY: 1,
    pageWidth: PAGE_WIDTH,
    pageHeight: PAGE_HEIGHT,
    pageLayout: 'vertical',
  });
  const frame = new PageFrameElement(uuid);
  frame.bindToYMap(yMap);
  return frame;
}

function makeCanvas(elements: DrawableElement[], point: Vector2) {
  const enterElementEdit = vi.fn();
  // Mirrors DrawableCanvas.enterEditAtPoint: hit-test the topmost editable
  // element under the point, select it exclusively, and enter its edit mode.
  const enterEditAtPoint = vi.fn((p: Vector2, event?: Event) => {
    for (let i = elements.length - 1; i >= 0; i--) {
      const element = elements[i];
      if (!CollisionHelper.inBox(p, element.boundingBox) || !element.editable) {
        continue;
      }
      for (const other of elements) {
        if (other !== element) {
          other.unselect();
        }
      }
      element.select();
      enterElementEdit(element, event);
      return true;
    }
    return false;
  });
  const canvas = {
    elements,
    enterElementEdit,
    enterEditAtPoint,
    viewport: {
      getPoint: vi.fn(() => point),
      zoom: 1,
    },
  } as unknown as DrawableCanvas;
  enterElementEdit.mockImplementation((element: DrawableElement) => {
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

  it('modifier+click adds an element to the selection without clearing others', () => {
    const { image: a } = makeImageElement('a', 0, 0);
    const { image: b } = makeImageElement('b', 200, 0);
    a.select();
    const { canvas } = makeCanvas([a, b], { x: 210, y: 10 });
    const tool = new SelectTool(() => catalogs.en);
    // Set both modifiers so the test is agnostic to the platform the tool reads.
    const event = { ctrlKey: true, metaKey: true } as unknown as PointerEvent;

    tool.start(canvas, event);
    tool.finish(canvas, event);

    expect(a.isSelected).toBe(true);
    expect(b.isSelected).toBe(true);
  });

  it('modifier+click removes an already-selected element from the selection', () => {
    const { image: a } = makeImageElement('a', 0, 0);
    const { image: b } = makeImageElement('b', 200, 0);
    a.select();
    b.select();
    const { canvas } = makeCanvas([a, b], { x: 210, y: 10 });
    const tool = new SelectTool(() => catalogs.en);
    const event = { ctrlKey: true, metaKey: true } as unknown as PointerEvent;

    tool.start(canvas, event);
    tool.finish(canvas, event);

    expect(a.isSelected).toBe(true);
    expect(b.isSelected).toBe(false);
  });

  it('modifier+click on empty space preserves the current selection', () => {
    const { image: a } = makeImageElement('a', 0, 0);
    a.select();
    const { canvas } = makeCanvas([a], { x: 500, y: 500 });
    const tool = new SelectTool(() => catalogs.en);
    const event = { ctrlKey: true, metaKey: true } as unknown as PointerEvent;

    tool.start(canvas, event);
    tool.finish(canvas, event);

    expect(a.isSelected).toBe(true);
  });

  it('marquees over an unselected page frame instead of moving it', () => {
    const frame = makePageFrame();
    const { image } = makeImageElement('ink', 200, 200);
    const start = { x: 50, y: 50 };
    const { canvas } = makeCanvas([frame, image], start);
    const tool = new SelectTool(() => catalogs.en);
    const event = {} as PointerEvent;

    tool.start(canvas, event);
    tool.update(canvas, event, { x: 400, y: 400 });
    tool.finish(canvas, event);

    expect(image.isSelected).toBe(true);
    expect(frame.isSelected).toBe(false);
    expect(frame.offset).toEqual({ x: 0, y: 0 });
  });

  it('selects the page frame a marquee started on when it caught nothing', () => {
    const frame = makePageFrame();
    const point = { x: 50, y: 50 };
    const { canvas } = makeCanvas([frame], point);
    const tool = new SelectTool(() => catalogs.en);
    const event = {} as PointerEvent;

    tool.start(canvas, event);
    // A pen tap wobbles by a pixel or two before it lifts.
    tool.update(canvas, event, { x: 52, y: 51 });
    tool.finish(canvas, event);

    expect(frame.isSelected).toBe(true);
    expect(frame.offset).toEqual({ x: 0, y: 0 });
  });

  it('moves an already-selected page frame dragged from its body', () => {
    const frame = makePageFrame();
    frame.select();
    const start = { x: 50, y: 50 };
    const { canvas } = makeCanvas([frame], start);
    const tool = new SelectTool(() => catalogs.en);
    const event = {} as PointerEvent;

    tool.start(canvas, event);
    tool.update(canvas, event, { x: 80, y: 90 });
    tool.finish(canvas, event);

    expect(frame.isSelected).toBe(true);
    expect(frame.offset).toEqual({ x: 30, y: 40 });
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
