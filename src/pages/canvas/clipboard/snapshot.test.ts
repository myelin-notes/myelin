import { describe, expect, it } from 'vitest';
import {
  prosemirrorToYXmlFragment,
  yXmlFragmentToProseMirrorRootNode,
} from 'y-prosemirror';
import * as Y from 'yjs';
import { ElementType } from '../elements/element-type';
import { parseMarkdownToDoc } from '../page-frame/markdown-parser';
import { schema } from '../page-frame/pm/schema';
import { YDocManager } from '../ydoc-manager';
import {
  buildCanvasClipboardSnapshot,
  openCanvasClipboardDocument,
  parseCanvasClipboardSnapshot,
  serializeCanvasClipboardSnapshot,
} from './snapshot';
import type { CanvasClipboardSelection } from './types';

function createSelection(): {
  selection: CanvasClipboardSelection;
  sourceDoc: YDocManager;
} {
  const sourceDoc = new YDocManager();

  const strokePoints = new Y.Array<number>();
  strokePoints.push([10, 20, 1, 30, 40, 0.5]);
  const stroke = sourceDoc.createElementMap(ElementType.STROKE, 0, {
    offsetX: 12,
    offsetY: 18,
    scaleX: 1,
    scaleY: 1,
    color: '#111111',
    size: 8,
    hasPressure: true,
    points: strokePoints,
  });

  const image = sourceDoc.createElementMap(ElementType.IMAGE, 1, {
    offsetX: 60,
    offsetY: 72,
    scaleX: 1,
    scaleY: 1,
    naturalWidth: 320,
    naturalHeight: 180,
    imageData: new Uint8Array([1, 2, 3, 4]),
  });

  const pdf = sourceDoc.createElementMap(ElementType.PDF, 2, {
    offsetX: 110,
    offsetY: 140,
    scaleX: 1,
    scaleY: 1,
    fileName: 'deck.pdf',
    pageSizes: [{ w: 612, h: 792 }],
    pageOrder: [{ kind: 'pdf', originalIndex: 0 }],
    pdfData: new Uint8Array([9, 8, 7, 6]),
  });

  const pageFrame = sourceDoc.createElementMap(ElementType.PAGE_FRAME, 3, {
    offsetX: 200,
    offsetY: 220,
    scaleX: 1,
    scaleY: 1,
    pageWidth: 680,
    pageHeight: 880,
  });
  prosemirrorToYXmlFragment(
    parseMarkdownToDoc('Hello **canvas** clipboard', schema),
    sourceDoc.getXmlFragment(3),
  );

  return {
    sourceDoc,
    selection: {
      noteId: 'note-1',
      bounds: { x: 12, y: 18, width: 868, height: 1082 },
      items: [
        {
          index: 0,
          type: ElementType.STROKE,
          bounds: { x: 12, y: 18, width: 40, height: 36 },
          yMap: stroke,
        },
        {
          index: 1,
          type: ElementType.IMAGE,
          bounds: { x: 60, y: 72, width: 320, height: 180 },
          yMap: image,
        },
        {
          index: 2,
          type: ElementType.PDF,
          bounds: { x: 110, y: 140, width: 612, height: 792 },
          yMap: pdf,
        },
        {
          index: 3,
          type: ElementType.PAGE_FRAME,
          bounds: { x: 200, y: 220, width: 680, height: 880 },
          yMap: pageFrame,
          pageFrameFragment: sourceDoc.getXmlFragment(3),
        },
      ],
    },
  };
}

describe('canvas clipboard snapshot', () => {
  it('round-trips mixed Yjs-backed selections', () => {
    const { selection } = createSelection();

    const snapshot = buildCanvasClipboardSnapshot(selection);
    const serialized = serializeCanvasClipboardSnapshot(snapshot);
    const parsed = parseCanvasClipboardSnapshot(serialized);

    expect(parsed).not.toBeNull();
    expect(parsed?.sourceNoteId).toBe('note-1');
    expect(parsed?.selectionBounds).toEqual(selection.bounds);

    const clipboardDoc = openCanvasClipboardDocument(parsed!);
    expect(clipboardDoc.elements.length).toBe(4);

    const decodedStroke = clipboardDoc.elements.get(0);
    expect((decodedStroke.get('points') as Y.Array<number>).toArray()).toEqual([
      10, 20, 1, 30, 40, 0.5,
    ]);

    const decodedImage = clipboardDoc.elements.get(1);
    expect(Array.from(decodedImage.get('imageData') as Uint8Array)).toEqual([
      1, 2, 3, 4,
    ]);

    const decodedPdf = clipboardDoc.elements.get(2);
    expect(decodedPdf.get('fileName')).toBe('deck.pdf');
    expect(Array.from(decodedPdf.get('pdfData') as Uint8Array)).toEqual([
      9, 8, 7, 6,
    ]);

    const decodedPageFrame = yXmlFragmentToProseMirrorRootNode(
      clipboardDoc.getXmlFragment(3),
      schema,
    );
    expect(decodedPageFrame.textContent).toContain('Hello');
    expect(decodedPageFrame.textContent).toContain('canvas');
    expect(decodedPageFrame.textContent).toContain('clipboard');
  });

  it('keeps pasted page-frame content independent from the source fragment', () => {
    const { selection, sourceDoc } = createSelection();
    const snapshot = buildCanvasClipboardSnapshot(selection);
    const clipboardDoc = openCanvasClipboardDocument(snapshot);

    const decodedParagraph = clipboardDoc.getXmlFragment(3).toArray()[0];
    expect(decodedParagraph).toBeInstanceOf(Y.XmlElement);

    const decodedText = (decodedParagraph as Y.XmlElement).toArray()[0];
    expect(decodedText).toBeInstanceOf(Y.XmlText);

    (decodedText as Y.XmlText).insert(
      (decodedText as Y.XmlText).length,
      ' copy',
    );

    const sourcePmDoc = yXmlFragmentToProseMirrorRootNode(
      sourceDoc.getXmlFragment(3),
      schema,
    );
    const decodedPmDoc = yXmlFragmentToProseMirrorRootNode(
      clipboardDoc.getXmlFragment(3),
      schema,
    );

    expect(sourcePmDoc.textContent).toBe('Hello canvas clipboard');
    expect(decodedPmDoc.textContent).toBe('Hello canvas clipboard copy');
  });
});
