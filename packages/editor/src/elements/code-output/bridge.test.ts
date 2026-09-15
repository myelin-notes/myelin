import { describe, expect, it, vi } from 'vitest';
import type { DrawableCanvas } from '../../drawable-canvas';
import { ensureCodeOutputCard } from './bridge';

describe('ensureCodeOutputCard', () => {
  it('adds a card to the canvas supplied by its caller', () => {
    const updateBounds = vi.fn();
    const firstCanvas = {
      getElementsByType: vi.fn(() => []),
      getElementByUuid: vi.fn(() => ({
        boundingBox: new DOMRect(10, 20, 100, 200),
      })),
      viewport: {
        getPoint: vi.fn(() => ({ x: 30, y: 40 })),
      },
      addElement: vi.fn(() => ({ updateBounds })),
    } as unknown as DrawableCanvas;
    const secondCanvas = {
      getElementsByType: vi.fn(() => []),
      getElementByUuid: vi.fn(),
      viewport: {
        getPoint: vi.fn(),
      },
      addElement: vi.fn(),
    } as unknown as DrawableCanvas;

    ensureCodeOutputCard(firstCanvas, {
      frameUuid: 'frame-1',
      blockId: 'block-1',
      blockScreenRect: {
        left: 1,
        right: 4,
        top: 2,
        bottom: 6,
        width: 3,
        height: 4,
      },
      pageLayout: 'horizontal',
    });

    expect(firstCanvas.addElement).toHaveBeenCalledOnce();
    expect(updateBounds).toHaveBeenCalledOnce();
    expect(secondCanvas.addElement).not.toHaveBeenCalled();
  });
});
