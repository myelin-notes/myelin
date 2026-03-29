import type { UndoCommand } from '../../../lib/utils/undo-redo';
import type { PageFrameElement } from '../elements/page-frame-element';
import type { EditableBlock } from '../page-frame/block-editor';

export class EditPageFrameCommand implements UndoCommand {
  constructor(
    private element: PageFrameElement,
    private oldBlocks: EditableBlock[],
    private newBlocks: EditableBlock[],
  ) {}

  execute() {
    this.element.editor.setBlocks(this.newBlocks);
  }

  undo() {
    this.element.editor.setBlocks(this.oldBlocks);
  }
}
