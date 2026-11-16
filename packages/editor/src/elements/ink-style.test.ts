import { describe, expect, it } from 'vitest';
import type * as Y from 'yjs';
import { CanvasDocumentBinding } from '../canvas-document-binding';
import { parseCssColor } from '../pdf-export/color';
import { YDocManager } from '../ydoc-manager';
import { applyInkStyle, readInkStyle } from './ink-style';
import { ShapeElement } from './shape-element';
import { StrokeElement } from './stroke-element';

const INK = '#191c1e';
const HIGHLIGHT = 'rgba(250,204,21,0.3)';

function createBinding(ydoc: YDocManager) {
  const binding = new CanvasDocumentBinding({
    ydoc,
    createElementFromYMap: (_yMap: Y.Map<unknown>) => null,
    initializeElement: (element, yMap) => element.bindToYMap(yMap),
    onChange: () => {},
    onRemoteChange: () => {},
    onElementRemoved: () => {},
  });
  binding.hydrate();
  return binding;
}

function addStroke(
  binding: CanvasDocumentBinding,
  color = INK,
  size = 8,
): StrokeElement {
  const stroke = binding.addElement(
    (uuid) => new StrokeElement(uuid, [], false, { color, size }),
    undefined,
  );
  stroke.addPoint(0, 0, 0.5);
  stroke.addPoint(100, 0, 0.5);
  stroke.addPoint(200, 0, 0.5);
  stroke.commit();
  stroke.updateBounds();
  return stroke;
}

function addLine(binding: CanvasDocumentBinding): ShapeElement {
  return binding.addElement(
    (uuid) =>
      new ShapeElement(uuid, 'line', [0, 0, 200, 0], { color: INK, size: 8 }),
    undefined,
  );
}

describe('ink style', () => {
  it('saves a new thickness and regrows the bounds the renderer culls by', () => {
    const ydoc = new YDocManager();
    const binding = createBinding(ydoc);
    const stroke = addStroke(binding);
    const height = stroke.localBoundingBox.height;

    applyInkStyle([stroke], { thickness: 24 });

    expect(stroke.yMap?.get('size')).toBe(24);
    expect(stroke.localBoundingBox.height).toBeGreaterThan(height * 2);
  });

  it.each([
    { name: 'stroke', add: addStroke },
    { name: 'shape', add: addLine },
  ])('undoes a restyled $name, bounds included', ({ add }) => {
    const ydoc = new YDocManager();
    const binding = createBinding(ydoc);
    const element = add(binding);
    const height = element.localBoundingBox.height;
    ydoc.undoManager.stopCapturing();

    applyInkStyle([element], { color: '#ef4444', thickness: 24 });
    expect(element.localBoundingBox.height).toBeGreaterThan(height);

    ydoc.undoManager.undo();

    expect(element.strokeStyle.color).toBe(INK);
    expect(element.strokeStyle.size).toBe(8);
    expect(element.localBoundingBox.height).toBe(height);
  });

  it('keeps a highlight translucent, and pen ink opaque, when recoloring', () => {
    const binding = createBinding(new YDocManager());
    const highlight = addStroke(binding, HIGHLIGHT, 36);
    const pen = addStroke(binding);

    applyInkStyle([highlight, pen], { color: '#60a5fa' });

    expect(parseCssColor(highlight.strokeStyle.color)).toEqual({
      rgb: [96, 165, 250],
      opacity: 0.3,
    });
    expect(pen.strokeStyle.color).toBe('#60a5fa');
  });

  it('reports a highlight in the palette form so its swatch can show as active', () => {
    const binding = createBinding(new YDocManager());
    const highlight = addStroke(binding, HIGHLIGHT, 36);
    const pen = addStroke(binding);

    expect(readInkStyle([highlight])).toEqual({
      color: '#facc15',
      thickness: 36,
      highlighter: true,
    });
    expect(readInkStyle([highlight, pen])?.highlighter).toBe(false);
  });

  it('means rendered width on a stroke that has been resized', () => {
    const binding = createBinding(new YDocManager());
    const stroke = addStroke(binding);
    stroke.setScale(2, 2);

    expect(readInkStyle([stroke])?.thickness).toBe(16);

    applyInkStyle([stroke], { thickness: 8 });

    expect(stroke.strokeStyle.size).toBe(4);
    expect(readInkStyle([stroke])?.thickness).toBe(8);
  });

  it('leaves locked ink alone', () => {
    const binding = createBinding(new YDocManager());
    const locked = addStroke(binding);
    locked.setLocked(true);

    expect(readInkStyle([locked])).toBeNull();

    applyInkStyle([locked], { color: '#ef4444', thickness: 24 });

    expect(locked.strokeStyle.color).toBe(INK);
    expect(locked.strokeStyle.size).toBe(8);
  });
});
