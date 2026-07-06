import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { ElementType } from './elements/element-type';
import { writeYMap } from './y-fields';
import { ASYNC_RESULT_ORIGIN, YDocManager } from './ydoc-manager';

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

describe('async-result origin writes', () => {
  it('adds no undo step of its own', () => {
    const ydoc = new YDocManager();
    const yMap = ydoc.createElementMap(ElementType.AUDIO, 'audio-1', {
      transcript: '',
    });
    ydoc.undoManager.stopCapturing();

    writeYMap(yMap, { transcript: 'hello world' }, ASYNC_RESULT_ORIGIN);

    // The next undo skips straight past the transcript write and reverts the
    // element creation itself.
    ydoc.undoManager.undo();
    expect(ydoc.elements.length).toBe(0);
  });

  it('restores the transcript when undoing the element deletion', () => {
    const ydoc = new YDocManager();
    const yMap = ydoc.createElementMap(ElementType.AUDIO, 'audio-1', {
      transcript: '',
    });
    writeYMap(yMap, { transcript: 'hello world' }, ASYNC_RESULT_ORIGIN);
    ydoc.undoManager.stopCapturing();

    ydoc.removeElementMap(yMap);
    expect(ydoc.elements.length).toBe(0);

    ydoc.undoManager.undo();
    expect(ydoc.elements.length).toBe(1);
    expect(ydoc.elements.get(0).get('transcript')).toBe('hello world');
  });
});

describe('YDocManager.sweepOrphanPageFrameFragments', () => {
  it('clears fragments whose uuid no longer matches any element', () => {
    const ydoc = new YDocManager();
    // Manually create an orphan: fragment exists but no element references it.
    const orphan = ydoc.getXmlFragment('ghost-1');
    orphan.insert(0, [withParagraph('orphan content')]);
    expect(orphan.length).toBe(1);

    const cleared = ydoc.sweepOrphanPageFrameFragments();

    expect(cleared).toBe(1);
    expect(orphan.length).toBe(0);
  });

  it('leaves fragments belonging to live page frames alone', () => {
    const ydoc = new YDocManager();
    ydoc.createElementMap(ElementType.PAGE_FRAME, 'live-1', {});
    const live = ydoc.getXmlFragment('live-1');
    live.insert(0, [withParagraph('live content')]);

    const cleared = ydoc.sweepOrphanPageFrameFragments();

    expect(cleared).toBe(0);
    expect(live.length).toBe(1);
  });

  it('only touches fragments with the pf- prefix', () => {
    const ydoc = new YDocManager();
    const stranger = ydoc.doc.getXmlFragment('not-a-page-frame');
    stranger.insert(0, [withParagraph('keep me')]);

    ydoc.sweepOrphanPageFrameFragments();

    expect(stranger.length).toBe(1);
  });

  it('mops up concurrent edit-while-delete orphans across two peers', () => {
    // Simulate two peers, A and B. Both start with the same page frame.
    const a = new YDocManager();
    const b = new YDocManager();
    const yMap = a.createElementMap(ElementType.PAGE_FRAME, 'frame-1', {});
    a.getXmlFragment('frame-1').insert(0, [withParagraph('initial')]);
    b.applyUpdate(Y.encodeStateAsUpdate(a.doc));

    // A deletes the frame. B concurrently appends a paragraph to the fragment.
    a.removeElementMap(yMap);
    b.getXmlFragment('frame-1').insert(1, [withParagraph('B was here')]);

    // Sync both ways.
    const aSv = Y.encodeStateVector(a.doc);
    const bSv = Y.encodeStateVector(b.doc);
    a.applyUpdate(Y.encodeStateAsUpdate(b.doc, aSv));
    b.applyUpdate(Y.encodeStateAsUpdate(a.doc, bSv));

    // After merge, the element is gone on both sides but B's late insert
    // survives in the fragment as an orphan.
    expect(a.elements.length).toBe(0);
    expect(b.elements.length).toBe(0);
    expect(a.getXmlFragment('frame-1').length).toBeGreaterThan(0);
    expect(b.getXmlFragment('frame-1').length).toBeGreaterThan(0);

    // Sweep on save — A persists, then sync.
    const cleared = a.sweepOrphanPageFrameFragments();
    expect(cleared).toBe(1);
    expect(a.getXmlFragment('frame-1').length).toBe(0);

    b.applyUpdate(Y.encodeStateAsUpdate(a.doc, Y.encodeStateVector(b.doc)));
    expect(b.getXmlFragment('frame-1').length).toBe(0);
  });

  it('does not clear when called on a doc with no orphans', () => {
    const ydoc = new YDocManager();
    ydoc.createElementMap(ElementType.PAGE_FRAME, 'frame-1', {});
    ydoc.getXmlFragment('frame-1').insert(0, [withParagraph('alive')]);

    expect(ydoc.sweepOrphanPageFrameFragments()).toBe(0);
  });
});
