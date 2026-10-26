import { EditorState, type Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { describe, expect, it, vi } from 'vitest';
import {
  initProseMirrorDoc,
  prosemirrorToYXmlFragment,
  ySyncPlugin,
} from 'y-prosemirror';
import * as Y from 'yjs';
import type { DrawableCanvas } from '../drawable-canvas';
import type { DrawableElement } from '../elements/drawable-element';
import { ElementType } from '../elements/element-type';
import { PAGE_GAP, PageFrameElement } from '../elements/page-frame-element';
import { PdfElement } from '../elements/pdf';
import { StrokeElement } from '../elements/stroke-element';
import type { PdfPageOrderEntry } from '../pdf-renderer';
import { YDocManager } from '../ydoc-manager';
import { PageFrameAnchoring, pageContainsPoint } from './anchoring';
import {
  anchorGapsKey,
  anchorGapsPlugin,
  encodeAnchorPosition,
} from './pm/anchoring';
import type { PageFrameEditorState } from './pm/editor-state';
import { schema } from './pm/schema';

function stroke(points: number[]) {
  const element = new StrokeElement('stroke', points, false, {
    color: 'black',
    size: 2,
  });
  element.updateBounds();
  return element;
}
function controller(elements: DrawableElement[]) {
  return new PageFrameAnchoring({
    elements,
    transact: (fn: () => void) => fn(),
  } as unknown as DrawableCanvas);
}

describe('page frame anchoring', () => {
  it('anchors at either endpoint, prioritizing the start and the topmost frame', () => {
    const first = new PageFrameElement('first');
    const top = new PageFrameElement('top');
    const end = new PageFrameElement('end');
    end.setOffset(2000, 0);
    const anchors = controller([first, top, end]);
    const attach = vi.spyOn(anchors, 'attach').mockReturnValue(true);
    const crossing = stroke([10, 20, 0.5, 2010, 20, 0.5]);
    anchors.autoAnchorStroke(crossing);
    expect(attach).toHaveBeenLastCalledWith(crossing, top, { x: 10, y: 20 });
    const ending = stroke([-100, -100, 0.5, 2010, 20, 0.5]);
    anchors.autoAnchorStroke(ending);
    expect(attach).toHaveBeenLastCalledWith(ending, end, { x: 2010, y: 20 });
    attach.mockClear();
    anchors.autoAnchorStroke(stroke([-100, 20, 0.5, 1000, 20, 0.5]));
    expect(attach).not.toHaveBeenCalled();
  });

  it('excludes page gaps and chrome, and supports all layouts', () => {
    const frame = new PageFrameElement('frame');
    frame.numPages = 2;
    expect(pageContainsPoint(frame, { x: 20, y: -10 })).toBe(false);
    expect(
      pageContainsPoint(frame, { x: 20, y: frame.pageHeight + PAGE_GAP / 2 }),
    ).toBe(false);
    expect(
      pageContainsPoint(frame, { x: 20, y: frame.pageHeight + PAGE_GAP + 20 }),
    ).toBe(true);
    frame.setPageLayout('horizontal');
    expect(
      pageContainsPoint(frame, { x: frame.pageWidth + PAGE_GAP + 20, y: 20 }),
    ).toBe(true);
    frame.setPageLayout('continuous');
    frame.setMeasuredContentHeight(2000);
    expect(pageContainsPoint(frame, { x: 20, y: 1500 })).toBe(true);
  });

  it('keeps fragments at one gap through refresh and deletion of a fragment', () => {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment('page');
    prosemirrorToYXmlFragment(
      schema.node('doc', null, [
        schema.node('paragraph', null, schema.text('above')),
        schema.node('paragraph', null, schema.text('below')),
      ]),
      fragment,
    );
    const initial = initProseMirrorDoc(fragment, schema);
    const view = {
      state: EditorState.create({
        doc: initial.doc,
        plugins: [
          ySyncPlugin(fragment, { mapping: initial.mapping }),
          anchorGapsPlugin(),
        ],
      }),
      dispatch(tr: Transaction) {
        this.state = this.state.apply(tr);
      },
      coordsAtPos: () => ({ left: 48, top: 250 }),
      dom: {
        querySelectorAll: () =>
          (anchorGapsKey.getState(view.state) ?? []).map((gap, index) => ({
            dataset: { pageAnchor: gap.id },
            getBoundingClientRect: () =>
              new DOMRect(48, 100 + index * gap.height, 100, gap.height),
          })),
      },
    };
    const frame = new PageFrameElement('frame');
    frame.pmEditor = {
      view: view as unknown as EditorView,
    } as PageFrameEditorState;
    frame.mountDOM(
      {} as HTMLDivElement,
      {
        offsetWidth: 640,
        getBoundingClientRect: () => new DOMRect(0, 0, 640, 880),
      } as HTMLDivElement,
    );
    const first = stroke([0, 0, 0.5, 10, 0, 0.5]);
    const second = new StrokeElement(
      'second',
      [20, 0, 0.5, 30, 0, 0.5],
      false,
      { color: 'black', size: 2 },
    );
    second.updateBounds();
    for (const element of [first, second]) {
      element.setMakesSpace(true);
      element.setPageAnchor({
        frameId: frame.uuid,
        position: encodeAnchorPosition(view.state, 3),
        blockPosition: encodeAnchorPosition(view.state, 0),
        spaceBefore: 0,
        x: 20,
        y: 10,
        sharedGap: { id: 'erased-group', height: 80 },
      });
    }
    const elements: DrawableElement[] = [frame, first, second];
    const anchors = controller(elements);
    anchors.refresh();
    expect(anchorGapsKey.getState(view.state)).toEqual([
      { id: 'erased-group', pos: 3, height: 80 },
    ]);
    expect(first.offset).toEqual({ x: 20, y: 110 });
    expect(second.offset).toEqual(first.offset);
    expect(anchors.attachAtPosition(first, frame, 3)).toBe(true);
    expect(anchorGapsKey.getState(view.state)?.map((gap) => gap.id)).toEqual([
      first.uuid,
      'erased-group',
    ]);
    elements.splice(1, 1);
    anchors.refresh();
    expect(anchorGapsKey.getState(view.state)).toEqual([
      { id: 'erased-group', pos: 3, height: 80 },
    ]);
    expect(second.offset).toEqual({ x: 20, y: 110 });
    elements.splice(1, 1);
    anchors.refresh();
    expect(anchorGapsKey.getState(view.state)).toEqual([]);
  });

  it('keeps partial overlap, unanchors after leaving, and does not reanchor children moving with their frame', () => {
    const frame = new PageFrameElement('frame');
    const element = stroke([-100, 20, 0.5, 10, 20, 0.5]);
    const anchor = {
      frameId: frame.uuid,
      position: [],
      blockPosition: [],
      spaceBefore: 0,
      x: 0,
      y: 0,
    };
    element.setPageAnchor(anchor);
    const anchors = controller([frame, element]);
    const attach = vi.spyOn(anchors, 'attach').mockReturnValue(true);
    anchors.finishTransform([frame, element]);
    expect(attach).not.toHaveBeenCalled();
    anchors.finishTransform([element]);
    expect(attach).toHaveBeenCalledOnce();
    element.translate(-1000, 0);
    anchors.finishTransform([element]);
    expect(element.pageAnchor).toBeNull();
    expect(element.offset.x).toBe(-1000);
  });
});

describe('PDF anchoring', () => {
  // Two 100x200 pages stacked vertically: page 1 starts at y = 200 + PAGE_GAP.
  function pdf(
    pageOrder: PdfPageOrderEntry[] = [
      { kind: 'pdf', originalIndex: 0 },
      { kind: 'pdf', originalIndex: 1 },
    ],
  ) {
    const ydoc = new YDocManager();
    const yMap = ydoc.createElementMap(ElementType.PDF, 'pdf', {
      offsetX: 0,
      offsetY: 0,
      scaleX: 1,
      scaleY: 1,
      pageSizes: [
        { w: 100, h: 200 },
        { w: 100, h: 200 },
      ],
      pageOrder,
      pageOrderCustom: true,
    });
    const element = new PdfElement('pdf');
    element.bindToYMap(yMap);
    return { element, yMap };
  }
  const insertBlankPage = (element: PdfElement, position: number) =>
    (
      element as unknown as { insertBlankPage(position: number): void }
    ).insertBlankPage(position);

  it('anchors margin strokes beside a page and keeps them on that page as the PDF changes', () => {
    const { element: document } = pdf();
    const pageTop = 200 + PAGE_GAP;
    const margin = stroke([120, pageTop + 50, 0.5, 130, pageTop + 60, 0.5]);
    const far = stroke([400, pageTop + 50, 0.5, 410, pageTop + 60, 0.5]);
    const anchors = controller([document, margin, far]);
    anchors.autoAnchorStroke(margin);
    anchors.autoAnchorStroke(far);
    expect(margin.pageAnchor).toMatchObject({ kind: 'pdf', page: 1 });
    expect(far.pageAnchor).toBeNull();

    const start = margin.boundingBox;
    document.setOffset(50, 10);
    document.setScale(2, 2);
    // Annotations stay glued to the content: scaled about the PDF's origin.
    const box = margin.boundingBox;
    expect(box.x).toBeCloseTo(50 + start.x * 2);
    expect(box.y).toBeCloseTo(10 + start.y * 2);
    expect(box.width).toBeCloseTo(start.width * 2);
    expect(box.height).toBeCloseTo(start.height * 2);

    const scaled = margin.boundingBox;
    insertBlankPage(document, 1);
    expect(margin.boundingBox.y).toBeCloseTo(scaled.y + (200 + PAGE_GAP) * 2);
    expect(margin.boundingBox.x).toBe(scaled.x);

    margin.translate(0, -(200 + PAGE_GAP) * 4);
    anchors.finishTransform([margin]);
    expect(margin.pageAnchor).toMatchObject({ kind: 'pdf', page: 0 });

    margin.translate(1000, 0);
    anchors.finishTransform([margin]);
    expect(margin.pageAnchor).toBeNull();
    const loose = margin.boundingBox;
    document.setScale(1, 1);
    expect(margin.boundingBox).toEqual(loose);
  });

  it('persists an id on a blank page from before ids so anchors survive reordering', () => {
    const { element: document, yMap } = pdf([
      { kind: 'pdf', originalIndex: 0 },
      { kind: 'blank', size: { w: 100, h: 200 } },
    ]);
    const pageTop = 200 + PAGE_GAP;
    const note = stroke([10, pageTop + 10, 0.5, 20, pageTop + 20, 0.5]);
    controller([document, note]).autoAnchorStroke(note);
    const id = (yMap.get('pageOrder') as PdfPageOrderEntry[])[1];
    expect(id).toMatchObject({ kind: 'blank', id: expect.any(String) });
    expect(note.pageAnchor).toMatchObject({
      page: (id as { id: string }).id,
    });

    const before = note.boundingBox.y;
    insertBlankPage(document, 0);
    expect(note.boundingBox.y).toBeCloseTo(before + 200 + PAGE_GAP);
  });

  it("deletes only the deleted page's anchored elements, restoring them on undo", () => {
    const ydoc = new YDocManager();
    const pdfMap = ydoc.createElementMap(ElementType.PDF, 'pdf', {
      pageSizes: [
        { w: 100, h: 200 },
        { w: 100, h: 200 },
      ],
      pageOrder: [
        { kind: 'pdf', originalIndex: 0 },
        { kind: 'pdf', originalIndex: 1 },
      ],
    });
    const anchor = (page: number) => ({
      pageAnchor: { kind: 'pdf', frameId: 'pdf', page, x: 0, y: 0 },
    });
    ydoc.createElementMap(ElementType.STROKE, 'on-first', anchor(0));
    ydoc.createElementMap(ElementType.STROKE, 'on-second', anchor(1));
    const document = new PdfElement('pdf');
    document.bindToYMap(pdfMap);
    document.bindSharedYState(ydoc);
    ydoc.undoManager.stopCapturing();

    (document as unknown as { deletePage(position: number): void }).deletePage(
      0,
    );
    const uuids = () => ydoc.elements.map((map) => map.get('uuid'));
    expect(uuids()).toEqual(['pdf', 'on-second']);

    ydoc.undoManager.undo();
    expect(uuids()).toEqual(expect.arrayContaining(['on-first', 'on-second']));
    expect(pdfMap.get('pageOrder')).toHaveLength(2);
  });
});
