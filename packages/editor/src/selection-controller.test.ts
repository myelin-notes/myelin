import { describe, expect, it } from 'vitest';
import type { DrawableElement } from './elements/drawable-element';
import { SelectionController } from './selection-controller';

function createElement(uuid: string, bounds: DOMRect): DrawableElement {
  let selected = false;
  return {
    uuid,
    get isSelected() {
      return selected;
    },
    get boundingBox() {
      return bounds;
    },
    select() {
      selected = true;
    },
    unselect() {
      selected = false;
    },
  } as DrawableElement;
}

describe('SelectionController', () => {
  it('owns selection and derives its shared bounds without a canvas', () => {
    const first = createElement('first', new DOMRect(10, 20, 30, 40));
    const second = createElement('second', new DOMRect(-5, 50, 20, 10));
    const controller = new SelectionController(() => [first, second]);

    controller.selectByUuid(['first', 'second']);

    expect(controller.selectedElements).toEqual([first, second]);
    expect(controller.getBounds()).toEqual(new DOMRect(-5, 20, 45, 40));

    controller.clear();
    expect(controller.selectedElements).toEqual([]);
  });
});
