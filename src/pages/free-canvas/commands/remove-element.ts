import type { UndoCommand } from '../../../lib/utils/undo-redo';
import type { DrawableElement } from '../elements/drawable-element';

export class RemoveElementCommand implements UndoCommand {
  private position = -1;
  constructor(
    private list: DrawableElement[],
    private element: DrawableElement,
  ) {}
  execute() {
    const idx = this.list.indexOf(this.element);
    if (idx >= 0) {
      this.position = idx;
      this.list.splice(idx, 1);
    }
  }
  undo() {
    if (this.position >= 0) {
      this.list.splice(
        Math.min(this.position, this.list.length),
        0,
        this.element,
      );
    }
  }
}
