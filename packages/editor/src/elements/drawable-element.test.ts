import { describe, expect, it } from 'vitest';
import { YDocManager } from '../ydoc-manager';
import { HANDLE_TOUCH_HIT_RADIUS } from './drawable-element';
import { ElementType } from './element-type';
import { StrokeElement, type StrokeStyle } from './stroke-element';

const STYLE: StrokeStyle = { color: '#191c1e', size: 8 };

describe('element locking', () => {
  it('loads and syncs locking alongside page anchoring', () => {
    const ydoc = new YDocManager();
    const yMap = ydoc.createElementMap(ElementType.STROKE, 'anchored-stroke', {
      points: [0, 0, 0.5, 10, 10, 0.5],
      locked: true,
      anchorFrame: 'frame-1',
      anchorBand: 'band-1',
    });
    const stroke = new StrokeElement(
      'anchored-stroke',
      [0, 0, 0.5, 10, 10, 0.5],
      false,
      STYLE,
    );
    stroke.bindToYMap(yMap);

    expect(stroke.locked).toBe(true);
    expect(stroke.anchoredFrameUuid).toBe('frame-1');
    expect(stroke.anchoredBandId).toBe('band-1');

    yMap.set('locked', false);
    yMap.set('anchorBand', 'band-2');
    stroke.syncFromYMap(['locked', 'anchorBand']);

    expect(stroke.locked).toBe(false);
    expect(stroke.anchoredBandId).toBe('band-2');
  });

  it('persists the lock and clears it when the Yjs field is removed', () => {
    const ydoc = new YDocManager();
    const yMap = ydoc.createElementMap(ElementType.STROKE, 'locked-stroke', {
      points: [0, 0, 0.5, 10, 10, 0.5],
    });
    const stroke = new StrokeElement(
      'locked-stroke',
      [0, 0, 0.5, 10, 10, 0.5],
      false,
      STYLE,
    );
    stroke.bindToYMap(yMap);

    stroke.setLocked(true);
    expect(yMap.get('locked')).toBe(true);

    const reloaded = new StrokeElement(
      'locked-stroke',
      [0, 0, 0.5, 10, 10, 0.5],
      false,
      STYLE,
    );
    reloaded.bindToYMap(yMap);
    expect(reloaded.locked).toBe(true);

    yMap.delete('locked');
    reloaded.syncFromYMap(['locked']);
    expect(reloaded.locked).toBe(false);
  });
});

describe('hitHandle', () => {
  it('reaches a handle a fingertip away only when touch is requested', () => {
    const stroke = new StrokeElement(
      'h1',
      [0, 0, 0.5, 100, 80, 0.5],
      false,
      STYLE,
    );
    stroke.updateBounds();
    const handle = stroke.getHandles()[0];
    // 15px out at zoom 1: past the mouse radius, inside the touch one, and far
    // from any neighbouring handle (the box is ~100x80).
    const point = { x: handle.position.x + 15, y: handle.position.y };

    expect(stroke.hitHandle(point, 1)).toBeNull();
    expect(stroke.hitHandle(point, 1, true)?.position).toEqual(handle.position);
  });

  it('picks the nearest handle when a small element makes several ambiguous', () => {
    const stroke = new StrokeElement(
      'h2',
      [0, 0, 0.5, 8, 8, 0.5],
      false,
      STYLE,
    );
    stroke.updateBounds();
    const handles = stroke.getHandles();
    // Bottom-right corner: last in the handle order, so first-match-wins would
    // answer with one of the edge handles the radius also covers.
    const corner = handles.reduce((a, b) =>
      b.position.x + b.position.y > a.position.x + a.position.y ? b : a,
    );
    const inRange = handles.filter(
      (h) =>
        Math.hypot(
          h.position.x - corner.position.x,
          h.position.y - corner.position.y,
        ) <= HANDLE_TOUCH_HIT_RADIUS,
    );

    expect(inRange.length).toBeGreaterThan(1);
    expect(stroke.hitHandle(corner.position, 1, true)?.position).toEqual(
      corner.position,
    );
  });
});

// The renderer draws only the elements this reports as visible, so anything it answers `false` for
// is invisible that frame no matter what it would paint.
describe('intersectsWorldRect', () => {
  const VIEW = new DOMRect(0, 0, 100, 100);

  function strokeAt(x: number, y: number): StrokeElement {
    const stroke = new StrokeElement(
      'k',
      [x, y, 0.5, x + 4, y + 4, 0.5, x + 8, y, 0.5],
      false,
      STYLE,
    );
    stroke.updateBounds();
    return stroke;
  }

  it('keeps an element inside the view', () => {
    expect(strokeAt(40, 40).intersectsWorldRect(VIEW, 0)).toBe(true);
  });

  it('keeps one that only overlaps an edge', () => {
    expect(strokeAt(-4, 50).intersectsWorldRect(VIEW, 0)).toBe(true);
  });

  it('drops one well outside on either axis', () => {
    expect(strokeAt(500, 50).intersectsWorldRect(VIEW, 0)).toBe(false);
    expect(strokeAt(50, -500).intersectsWorldRect(VIEW, 0)).toBe(false);
  });

  it('keeps one just outside when a margin is allowed for', () => {
    const stroke = strokeAt(140, 50);
    expect(stroke.intersectsWorldRect(VIEW, 0)).toBe(false);
    expect(stroke.intersectsWorldRect(VIEW, 128)).toBe(true);
  });

  it('follows the element offset rather than its local geometry', () => {
    // Local coordinates put this one in view; the offset is what actually
    // decides where it lands, and a test that ignored it would cull visible ink.
    const stroke = strokeAt(10, 10);
    stroke.setOffset(1000, 1000);
    expect(stroke.intersectsWorldRect(VIEW, 0)).toBe(false);

    stroke.setOffset(0, 0);
    expect(stroke.intersectsWorldRect(VIEW, 0)).toBe(true);
  });
});

it('reuses unchanged world bounds and refreshes them for live ink and transforms', () => {
  const stroke = new StrokeElement('bounds', [], false, STYLE);
  stroke.addPoint(10, 20, 0.5);
  const original = stroke.boundingBox;
  expect(stroke.boundingBox).toBe(original);
  stroke.addPoint(100, 200, 0.5);
  const grown = stroke.boundingBox;
  expect(grown.right).toBeGreaterThan(original.right);
  expect(stroke.boundingBox).toBe(grown);
  stroke.offset.x += 30;
  expect(stroke.boundingBox.x).toBe(grown.x + 30);
  stroke.scale.x = -2;
  const local = stroke.localBoundingBox;
  expect(stroke.boundingBox.x).toBe(local.right * -2 + 30);
  expect(stroke.boundingBox.width).toBe(local.width * 2);
  expect(original.right).toBeLessThan(grown.right);
});
