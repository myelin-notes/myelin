import { BlockType, registerBlockType } from './block-type-def';
import { BlockquoteBlock } from './blockquote';
import { Heading1Block, Heading2Block, Heading3Block } from './heading';
import { ListItemBlock } from './list-item';
import { ParagraphBlock } from './paragraph';

// ── Registration ─────────────────────────────────────────────

registerBlockType(BlockType.PARAGRAPH, new ParagraphBlock());
registerBlockType(BlockType.HEADING_1, new Heading1Block());
registerBlockType(BlockType.HEADING_2, new Heading2Block());
registerBlockType(BlockType.HEADING_3, new Heading3Block());
registerBlockType(BlockType.LIST_ITEM, new ListItemBlock());
registerBlockType(BlockType.BLOCKQUOTE, new BlockquoteBlock());

// ── Re-exports ───────────────────────────────────────────────

export type { BlockStyle } from './block-type-def';
export { BlockType, BlockTypeDef, BlockTypeRegistry } from './block-type-def';
