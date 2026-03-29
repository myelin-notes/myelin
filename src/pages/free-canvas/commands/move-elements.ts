import type { UndoCommand } from '../../../lib/utils/undo-redo';
import type { DrawableElement } from '../elements/drawable-element';

export class MoveElementsCommand implements UndoCommand {
  constructor(
    private targets: DrawableElement[],
    private dx: number,
    private dy: number,
  ) {}

  execute() {
    for (const e of this.targets) {
      e.translate(this.dx, this.dy);
    }
  }

  undo() {
    for (const e of this.targets) {
      e.translate(-this.dx, -this.dy);
    }
  }
}
