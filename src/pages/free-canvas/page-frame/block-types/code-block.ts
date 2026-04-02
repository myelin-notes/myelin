import { type BlockStyle, BlockTypeDef } from './block-type-def';

export class CodeBlockDef extends BlockTypeDef {
  readonly style: BlockStyle = {
    font: '400 14px "SF Mono", "Fira Code", Menlo, Consolas, monospace',
    size: 14,
    color: '#374151',
    indent: 0,
    css: {
      backgroundColor: '#f4f4f5',
      borderRadius: '8px',
      padding: '16px 20px',
      marginLeft: '-24px',
      marginRight: '-24px',
      overflowX: 'auto',
      whiteSpace: 'pre',
      wordBreak: 'normal',
    },
  };
  get markdownTrigger() {
    return /^```\w* $/;
  }
  get capturesEnter() {
    return true;
  }
}
