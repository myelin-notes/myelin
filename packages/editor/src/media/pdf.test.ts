import { describe, expect, it, vi } from 'vitest';
import type { DrawableCanvas } from '../drawable-canvas';
import { getPdfPageSizes } from '../pdf-renderer';
import { pdfImportHandler } from './pdf';

vi.mock('../elements/pdf-element', () => ({
  PdfElement: class {},
}));

vi.mock('../pdf-renderer', () => ({
  getPdfPageSizes: vi.fn(),
}));

vi.mock('../utils', () => ({
  getDevicePixelRatio: () => 1,
}));

describe('pdfImportHandler', () => {
  it('aligns the PDF top with the chosen insertion point', async () => {
    vi.mocked(getPdfPageSizes).mockResolvedValueOnce([{ w: 400, h: 900 }]);
    const pdf = {
      totalWidth: 400,
      totalHeight: 900,
      setInitialPdfData: vi.fn(),
      setOffset: vi.fn(),
      updateBounds: vi.fn(),
    };
    const canvas = {
      addElement: vi.fn(() => pdf),
      ctx: { canvas: { width: 1000, height: 800 } },
      viewport: {
        screenToWorld: ({ x, y }: { x: number; y: number }) => ({
          x: x + 10,
          y: y + 20,
        }),
      },
    } as unknown as DrawableCanvas;

    await pdfImportHandler(new Blob(['pdf']), canvas, {
      screenX: 300,
      screenY: 500,
    });

    expect(pdf.setOffset).toHaveBeenCalledWith(110, 520);
  });
});
