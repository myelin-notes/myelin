import type { UndoCommand } from '../../../lib/utils/undo-redo';
import type { PageFrameElement } from '../elements/page-frame-element';

export class EditPageFrameCommand implements UndoCommand {
  constructor(
    private element: PageFrameElement,
    private oldDocJSON: Record<string, unknown>,
    private newDocJSON: Record<string, unknown>,
  ) {}

  execute() {
    this.element.pmEditor.setDocJSON(this.newDocJSON);
  }

  undo() {
    this.element.pmEditor.setDocJSON(this.oldDocJSON);
  }
}
