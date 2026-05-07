import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { ElementType } from './elements/element-type';
import { YDocManager } from './ydoc-manager';

function withParagraph(text: string): Y.XmlElement {
  const p = new Y.XmlElement('paragraph');
  p.insert(0, [new Y.XmlText(text)]);
  return p;
}

describe('YDocManager.removeElementMap', () => {
  it('clears the matching pf-<uuid> fragment when a page frame is removed', () => {
    const ydoc = new YDocManager();
    const yMap = ydoc.createElementMap(ElementType.PAGE_FRAME, 'frame-1', {
      offsetX: 0,
      offsetY: 0,
    });
    const fragment = ydoc.getXmlFragment('frame-1');
    fragment.insert(0, [withParagraph('hello world')]);
    expect(fragment.length).toBe(1);

    ydoc.removeElementMap(yMap);

    expect(fragment.length).toBe(0);
  });

  it('leaves other page frames’ fragments untouched', () => {
    const ydoc = new YDocManager();
    const yMapA = ydoc.createElementMap(ElementType.PAGE_FRAME, 'frame-a', {});
    ydoc.createElementMap(ElementType.PAGE_FRAME, 'frame-b', {});
    const fragmentA = ydoc.getXmlFragment('frame-a');
    const fragmentB = ydoc.getXmlFragment('frame-b');
    fragmentA.insert(0, [withParagraph('a')]);
    fragmentB.insert(0, [withParagraph('b')]);

    ydoc.removeElementMap(yMapA);

    expect(fragmentA.length).toBe(0);
    expect(fragmentB.length).toBe(1);
  });

  it('does not touch fragments for non-page-frame element removals', () => {
    const ydoc = new YDocManager();
    const yMap = ydoc.createElementMap(ElementType.STROKE, 'stroke-1', {});
    const orphan = ydoc.getXmlFragment('stroke-1');
    orphan.insert(0, [withParagraph('untouched')]);

    ydoc.removeElementMap(yMap);

    expect(orphan.length).toBe(1);
  });

  it('restores both the element and its fragment content on undo', () => {
    const ydoc = new YDocManager();
    const yMap = ydoc.createElementMap(ElementType.PAGE_FRAME, 'frame-1', {
      displayName: 'Notes',
    });
    const fragment = ydoc.getXmlFragment('frame-1');
    fragment.insert(0, [withParagraph('keep me')]);
    ydoc.undoManager.stopCapturing();

    ydoc.removeElementMap(yMap);
    expect(ydoc.elements.length).toBe(0);
    expect(fragment.length).toBe(0);

    ydoc.undoManager.undo();

    expect(ydoc.elements.length).toBe(1);
    expect(fragment.length).toBe(1);
    const restored = fragment.get(0) as Y.XmlElement;
    expect(restored.toString()).toContain('keep me');
  });
});
