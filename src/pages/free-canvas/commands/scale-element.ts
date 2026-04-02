import type { UndoCommand } from '../../../lib/utils/undo-redo';
import type { Vector2 } from '../drawable-canvas';
import type { DrawableElement } from '../elements/drawable-element';

export class ScaleElementCommand implements UndoCommand {
  constructor(
    private element: DrawableElement,
    private oldScale: Vector2,
    private oldOffset: Vector2,
    private newScale: Vector2,
    private newOffset: Vector2,
  ) {}

  execute() {
    this.element.setScale(this.newScale.x, this.newScale.y);
    this.element.setOffset(this.newOffset.x, this.newOffset.y);
  }

  undo() {
    this.element.setScale(this.oldScale.x, this.oldScale.y);
    this.element.setOffset(this.oldOffset.x, this.oldOffset.y);
  }
}
