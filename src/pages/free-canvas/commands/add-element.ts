import type { UndoCommand } from '../../../lib/utils/undo-redo';
import type { DrawableElement } from '../elements/drawable-element';
import { ElementType } from '../elements/element-type';

export class AddElementCommand implements UndoCommand {
  constructor(
    private list: DrawableElement[],
    private element: DrawableElement,
  ) {}
  execute() {
    if (this.element.type === ElementType.PAGE_FRAME) {
      // Page frames draw first (below other elements)
      this.list.unshift(this.element);
    } else {
      this.list.push(this.element);
    }
  }
  undo() {
    const idx = this.list.indexOf(this.element);
    if (idx >= 0) {
      this.list.splice(idx, 1);
    }
  }
}
