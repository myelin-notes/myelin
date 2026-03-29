import type { BlockType } from './block-types';

export interface EditableBlock {
  type: BlockType;
  text: string;
}

export class BlockEditor {
  private _blocks: EditableBlock[] = [];

  get blocks(): EditableBlock[] {
    return this._blocks;
  }

  setBlocks(blocks: EditableBlock[]): void {
    this._blocks = blocks.map((b) => ({ ...b }));
  }

  snapshotBlocks(): EditableBlock[] {
    return this._blocks.map((b) => ({ ...b }));
  }

  trimTrailingEmpty(): void {
    while (
      this._blocks.length > 1 &&
      this._blocks[this._blocks.length - 1].text === ''
    ) {
      this._blocks.pop();
    }
  }
}
