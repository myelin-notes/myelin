import { describe, expect, it, vi } from 'vitest';
import type * as Y from 'yjs';
import { CanvasDocumentBinding } from './canvas-document-binding';
import { ElementType } from './elements/element-type';
import { PageFrameElement } from './elements/page-frame-element';
import { StrokeElement } from './elements/stroke-element';
import { YDocManager } from './ydoc-manager';

function createStroke(uuid: string): StrokeElement {
  return new StrokeElement(uuid, [], false, { color: 'black', size: 12 });
}

function createBinding(ydoc: YDocManager) {
  const removed = vi.fn();
  const changed = vi.fn();
  const createElementFromYMap = (yMap: Y.Map<unknown>) => {
    const uuid = yMap.get('uuid');
    if (typeof uuid !== 'string') {
      return null;
    }
    const element =
      yMap.get('type') === ElementType.PAGE_FRAME
        ? new PageFrameElement(uuid)
        : createStroke(uuid);
    element.bindToYMap(yMap);
    return element;
  };
  const binding = new CanvasDocumentBinding({
    ydoc,
    createElementFromYMap,
    initializeElement: (element, yMap) => element.bindToYMap(yMap),
    onChange: changed,
    onRemoteChange: changed,
    onElementRemoved: removed,
  });
  binding.hydrate();
  return { binding, changed, removed };
}

describe('CanvasDocumentBinding', () => {
  it('synchronizes remote updates and removals without canvas input or concrete media elements', () => {
    const ydoc = new YDocManager();
    const { binding, changed, removed } = createBinding(ydoc);
    const element = binding.addElement(createStroke, undefined);
    const yMap = element.yMap;

    expect(binding.elements).toEqual([element]);
    expect(ydoc.elements.length).toBe(1);

    ydoc.doc.transact(() => {
      yMap?.set('offsetX', 48);
    }, 'remote-peer');

    expect(element.offset.x).toBe(48);
    expect(changed).toHaveBeenCalled();

    ydoc.doc.transact(() => {
      ydoc.elements.delete(0, 1);
    }, 'remote-peer');

    expect(binding.elements).toEqual([]);
    expect(removed).toHaveBeenCalledWith(element);
    binding.destroy();
  });
});

it('deletes anchored children with a frame and restores them in one undo', () => {
  const ydoc = new YDocManager();
  const { binding } = createBinding(ydoc);
  const frame = binding.addElement(
    (uuid) => new PageFrameElement(uuid),
    undefined,
  );
  const child = binding.addElement(createStroke, undefined);
  const free = binding.addElement(createStroke, undefined);
  child.setPageAnchor({
    frameId: frame.uuid,
    position: [],
    blockPosition: [],
    spaceBefore: 0,
    x: 0,
    y: 0,
  });
  ydoc.undoManager.stopCapturing();
  binding.removeElement(frame);
  expect(binding.elements.map((element) => element.uuid)).toEqual([free.uuid]);
  ydoc.undoManager.undo();
  expect(new Set(binding.elements.map((element) => element.uuid))).toEqual(
    new Set([frame.uuid, child.uuid, free.uuid]),
  );
  ydoc.undoManager.redo();
  expect(binding.elements.map((element) => element.uuid)).toEqual([free.uuid]);
});
