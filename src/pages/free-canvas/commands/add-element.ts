import type { UndoCommand } from '../../../lib/utils/undo-redo';
import type { DrawableElement } from '../elements/drawable-element';

export class AddElementCommand implements UndoCommand {
  constructor(
    private list: DrawableElement[],
    private element: DrawableElement,
  ) {}
  execute() {
    this.list.push(this.element);
  }
  undo() {
    const idx = this.list.indexOf(this.element);
    if (idx >= 0) {
      this.list.splice(idx, 1);
    }
  }
}
