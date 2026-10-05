import { describe, expect, it } from 'vitest';
import { YDocManager } from '../ydoc-manager';
import type { PageFrameAnchor } from './anchorable-element';
import { ElementType } from './element-type';
import { ShapeElement } from './shape-element';
import { StrokeElement } from './stroke-element';

const anchor: PageFrameAnchor = {
  frameId: 'page',
  spaceBefore: 0,
  position: [],
  blockPosition: [],
  x: 10,
  y: 20,
};
const style = { color: 'black', size: 2 };

describe('anchorable elements', () => {
  it('defaults to unanchored, with space enabled except for strokes', () => {
    const shape = new ShapeElement('shape', 'rect', [0, 0, 30, 40], style);
    const stroke = new StrokeElement(
      'stroke',
      [0, 0, 0.5, 10, 10, 0.5],
      false,
      style,
    );
    expect(shape.pageAnchor).toBeNull();
    expect(stroke.pageAnchor).toBeNull();
    expect(shape.makesSpace).toBe(true);
    expect(stroke.makesSpace).toBe(false);
  });

  it('uses anchored positions for bounds, independent movement, and unanchoring', () => {
    const element = new ShapeElement('shape', 'rect', [0, 0, 30, 40], style);
    let origin = { x: 100, y: 200 };
    element.anchorOrigin = () => origin;
    element.setPageAnchor(anchor);
    expect(element.offset).toEqual({ x: 110, y: 220 });
    const bounds = element.boundingBox;
    origin = { x: 150, y: 260 };
    expect(element.boundingBox.x - bounds.x).toBe(50);
    expect(element.boundingBox.y - bounds.y).toBe(60);
    element.translate(7, 9);
    expect(element.pageAnchor).toMatchObject({ x: 17, y: 29 });
    expect(element.offset).toEqual({ x: 167, y: 289 });
    element.setPageAnchor(null);
    origin = { x: 0, y: 0 };
    expect(element.offset).toEqual({ x: 167, y: 289 });
  });

  it('persists anchor preferences and restores them through undo and redo', () => {
    const ydoc = new YDocManager();
    const element = new StrokeElement('stroke', [], false, style);
    const map = ydoc.createElementMap(
      ElementType.STROKE,
      element.uuid,
      element.getYMapProps(),
    );
    element.bindToYMap(map);
    ydoc.undoManager.stopCapturing();
    ydoc.transact(() => {
      element.setPageAnchor(anchor);
      element.setMakesSpace(true);
    });
    const loaded = new StrokeElement('stroke', [], false, style);
    loaded.bindToYMap(map);
    expect(loaded.pageAnchor).toEqual(anchor);
    expect(loaded.makesSpace).toBe(true);
    ydoc.undoManager.undo();
    loaded.syncFromYMap(['pageAnchor', 'makesSpace']);
    expect(loaded.pageAnchor).toBeNull();
    expect(loaded.makesSpace).toBe(false);
    ydoc.undoManager.redo();
    loaded.syncFromYMap(['pageAnchor', 'makesSpace']);
    expect(loaded.pageAnchor).toEqual(anchor);
    expect(loaded.makesSpace).toBe(true);
  });
});
