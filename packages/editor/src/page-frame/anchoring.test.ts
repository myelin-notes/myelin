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
import {
  PAGE_GAP,
  PAGE_PADDING,
  PageFrameElement,
} from '../elements/page-frame-element';
import { StrokeElement } from '../elements/stroke-element';
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

// Ten one-line paragraphs, 20px each from y = PAGE_PADDING (+ shift), with each anchor gap laid out
// above its paragraph. Paragraph k starts at pos 4k; world, local, and screen px coincide.
function laidOutFrame() {
  const doc = new Y.Doc();
  const fragment = doc.getXmlFragment('page');
  prosemirrorToYXmlFragment(
    schema.node(
      'doc',
      null,
      Array.from({ length: 10 }, (_, k) =>
        schema.node('paragraph', null, schema.text(`p${k}`)),
      ),
    ),
    fragment,
  );
  const initial = initProseMirrorDoc(fragment, schema);
  const layout = { shift: 0 };
  const measure = () => {
    const lines: number[] = [];
    const gaps: { id: string; rect: DOMRect }[] = [];
    let y = PAGE_PADDING + layout.shift;
    for (let k = 0; k <= 10; k++) {
      for (const gap of anchorGapsKey.getState(view.state) ?? []) {
        if (Math.floor(gap.pos / 4) === k) {
          gaps.push({ id: gap.id, rect: new DOMRect(48, y, 544, gap.height) });
          y += gap.height;
        }
      }
      if (k < 10) {
        lines.push(y);
        y += 20;
      }
    }
    return { lines, gaps, bottom: y };
  };
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
    posAtCoords: ({ top }: { top: number }) => {
      const { lines, bottom } = measure();
      if (top < PAGE_PADDING + layout.shift || top >= bottom) {
        return null;
      }
      return { pos: lines.findIndex((line) => top < line + 20) * 4 + 1 };
    },
    coordsAtPos: (pos: number) => ({
      left: 48,
      top: measure().lines[Math.min(9, Math.floor(pos / 4))],
    }),
    dom: {
      getBoundingClientRect: () =>
        new DOMRect(48, PAGE_PADDING + layout.shift, 544, measure().bottom),
      querySelectorAll: () =>
        measure().gaps.map(({ id, rect }) => ({
          dataset: { pageAnchor: id },
          getBoundingClientRect: () => rect,
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
  const image = stroke([100, 0, 0.5, 100, 60, 0.5]);
  image.setMakesSpace(true);
  const anchors = controller([frame, image]);
  const gaps = () =>
    (anchorGapsKey.getState(view.state) ?? []).map(({ pos, height }) => ({
      pos,
      height,
    }));
  const anchorAtParagraph = (k: number) => {
    anchors.attachAtPosition(image, frame, k * 4 + 1, true);
    return image.boundingBox.height;
  };
  return { frame, image, anchors, layout, gaps, anchorAtParagraph };
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

  it('drops below its own gap at the line it was released on, with no blank band above', () => {
    const { image, anchors, gaps, anchorAtParagraph } = laidOutFrame();
    const height = anchorAtParagraph(2);
    expect(image.boundingBox.top).toBe(PAGE_PADDING + 40);
    image.translate(0, 100);
    anchors.finishTransform([image]);
    expect(gaps()).toEqual([{ pos: 7 * 4 + 1, height }]);
    expect(image.boundingBox.top).toBe(PAGE_PADDING + 140);
  });

  it('anchors to the first line, not the end of the document, when dropped above the text', () => {
    const { image, anchors, gaps, anchorAtParagraph } = laidOutFrame();
    const height = anchorAtParagraph(5);
    image.translate(0, 10 - image.boundingBox.top);
    anchors.finishTransform([image]);
    expect(gaps()).toEqual([{ pos: 1, height }]);
    expect(image.boundingBox.top).toBe(PAGE_PADDING);
  });

  it('moves a gap that would end a paragraph to the start of the next, avoiding a trailing line break', () => {
    const { image, anchors, frame, gaps } = laidOutFrame();
    anchors.attachAtPosition(image, frame, 2 * 4 + 3, true);
    expect(gaps()).toEqual([
      { pos: 3 * 4 + 1, height: image.boundingBox.height },
    ]);
  });

  it('reflows text while dragging, keeps the element under the pointer, and rebinds it on drop', () => {
    const { image, anchors, layout, gaps, anchorAtParagraph } = laidOutFrame();
    const height = anchorAtParagraph(2);
    image.translate(0, 30);
    anchors.dragTransform([image]);
    // Its top is 10px into p3, so p2 moves above it.
    expect(gaps()).toEqual([{ pos: 3 * 4 + 1, height: height + 10 }]);
    expect(image.boundingBox.top).toBe(PAGE_PADDING + 70);
    layout.shift = 30;
    anchors.refresh();
    expect(image.boundingBox.top).toBe(PAGE_PADDING + 70);
    anchors.finishTransform([image]);
    anchors.endDrag();
    expect(gaps()).toEqual([{ pos: 2 * 4 + 1, height }]);
    expect(image.boundingBox.top).toBe(PAGE_PADDING + 70);
    layout.shift = 0;
    anchors.refresh();
    expect(image.boundingBox.top).toBe(PAGE_PADDING + 40);
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
