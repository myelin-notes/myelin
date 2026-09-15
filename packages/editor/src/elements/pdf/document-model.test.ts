import { describe, expect, it } from 'vitest';
import { PdfDocumentModel } from './document-model';

describe('PdfDocumentModel', () => {
  it('lays out pages independently of DOM or pdf.js', () => {
    const model = new PdfDocumentModel('horizontal');
    model.setPageSizes([
      { w: 612, h: 792 },
      { w: 300, h: 150 },
    ]);

    expect(model.layout).toMatchObject({
      totalWidth: 952,
      totalHeight: 792,
      pages: [
        { localLeft: 0, localTop: 0 },
        { localLeft: 652, localTop: 321 },
      ],
    });
  });

  it('inserts and deletes blank pages through a durable custom order', () => {
    const model = new PdfDocumentModel();
    model.setPageSizes([
      { w: 612, h: 792 },
      { w: 300, h: 150 },
    ]);

    expect(model.insertBlankPage(1)).toBe(true);
    expect(model.metadata).toEqual({
      pageSizes: [
        { w: 612, h: 792 },
        { w: 300, h: 150 },
      ],
      pageOrder: [
        { kind: 'pdf', originalIndex: 0 },
        { kind: 'blank', size: { w: 612, h: 792 } },
        { kind: 'pdf', originalIndex: 1 },
      ],
      pageOrderCustom: true,
    });
    expect(model.deletePage(1)).toBe(true);
    expect(model.metadata.pageOrder).toEqual([
      { kind: 'pdf', originalIndex: 0 },
      { kind: 'pdf', originalIndex: 1 },
    ]);
  });

  it('preserves a partial page order as custom metadata', () => {
    const model = new PdfDocumentModel();
    model.setPageSizes([
      { w: 612, h: 792 },
      { w: 300, h: 150 },
    ]);

    model.setPageOrder([{ kind: 'pdf', originalIndex: 1 }], true);

    expect(model.metadata).toMatchObject({
      pageOrder: [{ kind: 'pdf', originalIndex: 1 }],
      pageOrderCustom: true,
    });
  });
});
