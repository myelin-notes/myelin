import { describe, expect, it, vi } from 'vitest';
import { PdfChromeController } from './chrome-controller';

describe('PdfChromeController', () => {
  it('keeps every portal control at the element canvas rank', () => {
    const controller = new PdfChromeController(
      () => null,
      vi.fn(),
      vi.fn(),
    ) as unknown as {
      gapButtons: Map<number, { root: { style: { zIndex: string } } }>;
      deleteButtons: Map<number, { root: { style: { zIndex: string } } }>;
      setZIndex(zIndex: string): void;
    };
    const gapButton = { root: { style: { zIndex: '' } } };
    const deleteButton = { root: { style: { zIndex: '' } } };
    controller.gapButtons = new Map([[0, gapButton]]);
    controller.deleteButtons = new Map([[0, deleteButton]]);

    controller.setZIndex('2');

    expect(gapButton.root.style.zIndex).toBe('2');
    expect(deleteButton.root.style.zIndex).toBe('2');
  });
});
