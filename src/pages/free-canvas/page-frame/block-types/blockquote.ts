import { type BlockStyle, BlockTypeDef } from './block-type-def';

export class BlockquoteBlock extends BlockTypeDef {
  readonly style: BlockStyle = {
    font: '400 16px "Inter", sans-serif',
    size: 16,
    color: '#64748b',
    indent: 18,
    css: { borderLeft: '3px solid rgba(195, 199, 202, 0.5)' },
  };
  get markdownTrigger() {
    return /^> $/;
  }
}
