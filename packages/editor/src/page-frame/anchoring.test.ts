import { describe, expect, it, vi } from 'vitest';
import type { DrawableCanvas } from '../drawable-canvas';
import type { DrawableElement } from '../elements/drawable-element';
import { PAGE_GAP, PageFrameElement } from '../elements/page-frame-element';
import { StrokeElement } from '../elements/stroke-element';
import { PageFrameAnchoring, pageContainsPoint } from './anchoring';

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
