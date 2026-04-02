import type { BlockType } from '../page-frame/block-types';

export interface EditableBlock {
  type: BlockType;
  text: string;
}

export class BlockEditor {
  private _blocks: EditableBlock[] = [];
  private _version = 0;

  get blocks(): EditableBlock[] {
    return this._blocks;
  }

  get version(): number {
    return this._version;
  }

  setBlocks(blocks: EditableBlock[]): void {
    this._blocks = blocks.map((b) => ({ ...b }));
    this._version++;
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
