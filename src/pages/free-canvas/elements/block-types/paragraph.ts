import { BlockTypeDef, type BlockStyle } from "./block-type-def";

export class ParagraphBlock extends BlockTypeDef {
    readonly style: BlockStyle = { font: '400 16px "Inter", sans-serif', size: 16, color: "#191c1e", indent: 0 };
}
