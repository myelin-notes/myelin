import { type BlockStyle, BlockTypeDef } from './block-type-def';

export class Heading1Block extends BlockTypeDef {
  readonly style: BlockStyle = {
    font: '700 32px "Newsreader", serif',
    size: 32,
    color: '#191c1e',
    indent: 0,
  };
  get markdownTrigger() {
    return /^# $/;
  }
}

export class Heading2Block extends BlockTypeDef {
  readonly style: BlockStyle = {
    font: '700 24px "Newsreader", serif',
    size: 24,
    color: '#191c1e',
    indent: 0,
  };
  get markdownTrigger() {
    return /^## $/;
  }
}

export class Heading3Block extends BlockTypeDef {
  readonly style: BlockStyle = {
    font: '600 20px "Newsreader", serif',
    size: 20,
    color: '#191c1e',
    indent: 0,
  };
  get markdownTrigger() {
    return /^### $/;
  }
}
