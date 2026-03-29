import type { UndoCommand } from '../../../lib/utils/undo-redo';
import type { TextElement } from '../elements/text-element';

export class EditTextCommand implements UndoCommand {
  constructor(
    private element: TextElement,
    private oldText: string,
    private newText: string,
  ) {}

  execute() {
    this.element.setText(this.newText);
    this.element.updateBounds();
  }

  undo() {
    this.element.setText(this.oldText);
    this.element.updateBounds();
  }
}
