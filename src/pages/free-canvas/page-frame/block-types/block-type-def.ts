/** Serialized as a U8 in the binary format — values must stay stable and fit in 0–255. */
export enum BlockType {
  PARAGRAPH = 0,
  HEADING_1 = 1,
  HEADING_2 = 2,
  HEADING_3 = 3,
  LIST_ITEM = 4,
  BLOCKQUOTE = 5,
}

export interface BlockStyle {
  font: string;
  /** Font size in px — drives computed marginBottom and minHeight. */
  size: number;
  color: string;
  indent: number;
  /** Additional CSS overrides (e.g., borderLeft, position). */
  css?: React.CSSProperties;
}

export abstract class BlockTypeDef {
  abstract readonly style: BlockStyle;

  /** Regex that, when matched at the start of a block's text, converts the block to this type. */
  get markdownTrigger(): RegExp | null {
    return null;
  }

  /** If true, pressing Enter at the end of this block creates another of the same type. */
  get continuesOnEnter(): boolean {
    return false;
  }

  /** Create a non-editable decoration element (e.g., bullet) to prepend to the block. */
  createDecoration(): HTMLElement | null {
    return null;
  }
}

// ── Registry ─────────────────────────────────────────────────

const registry = new Map<BlockType, BlockTypeDef>();

export function registerBlockType(id: BlockType, def: BlockTypeDef): void {
  registry.set(id, def);
}

export namespace BlockTypeRegistry {
  export function get(type: BlockType): BlockTypeDef {
    return registry.get(type) ?? registry.get(BlockType.PARAGRAPH)!;
  }

  export function all(): IterableIterator<[BlockType, BlockTypeDef]> {
    return registry.entries();
  }
}
