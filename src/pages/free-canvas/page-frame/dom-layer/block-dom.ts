import { LINE_HEIGHT } from '../../elements/text-layout';
import type { EditableBlock } from '../block-editor';
import { BlockType, BlockTypeRegistry } from '../block-types';

// ── Block styles ────────────────────────────────────────────

const BLOCK_BASE_STYLES = new Map<BlockType, React.CSSProperties>();

for (const [type, def] of BlockTypeRegistry.all()) {
  const s = def.style;
  BLOCK_BASE_STYLES.set(type, {
    font: s.font,
    color: s.color,
    lineHeight: LINE_HEIGHT,
    paddingLeft: s.indent > 0 ? s.indent : undefined,
    marginBottom: s.size * 0.4,
    outline: 'none',
    minHeight: s.size * LINE_HEIGHT,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  });
}

export function getBlockStyle(type: BlockType): React.CSSProperties {
  const base =
    BLOCK_BASE_STYLES.get(type) ?? BLOCK_BASE_STYLES.get(BlockType.PARAGRAPH)!;
  const css = BlockTypeRegistry.get(type).style.css;
  return css ? { ...base, ...css } : base;
}

// ── DOM helpers ─────────────────────────────────────────────

export function readBlockType(div: HTMLElement): BlockType {
  const raw = div.dataset.blockType;
  return raw !== undefined ? (Number(raw) as BlockType) : BlockType.PARAGRAPH;
}

// ── DOM conversion ──────────────────────────────────────────

export function blocksToDOM(
  container: HTMLDivElement,
  blocks: EditableBlock[],
): void {
  container.innerHTML = '';
  if (blocks.length === 0) {
    const div = document.createElement('div');
    div.dataset.blockType = String(BlockType.PARAGRAPH);
    Object.assign(div.style, getBlockStyle(BlockType.PARAGRAPH));
    div.appendChild(document.createElement('br'));
    container.appendChild(div);
    return;
  }
  for (const block of blocks) {
    container.appendChild(createBlockElement(block));
  }
}

export function createBlockElement(block: EditableBlock): HTMLDivElement {
  const def = BlockTypeRegistry.get(block.type);
  const div = document.createElement('div');
  div.dataset.blockType = String(block.type);
  Object.assign(div.style, getBlockStyle(block.type));

  const decoration = def.createDecoration();
  if (decoration) {
    div.appendChild(decoration);
  }

  def.populateElement(div, block.text);
  return div;
}

export function domToBlocks(container: HTMLDivElement): EditableBlock[] {
  const blocks: EditableBlock[] = [];
  for (const child of container.children) {
    if (!(child instanceof HTMLDivElement)) {
      continue;
    }
    if (child.dataset.pageBreak) {
      continue;
    }
    const type = readBlockType(child);
    const text = BlockTypeRegistry.get(type).readText(child);

    blocks.push({ type, text });
  }
  return blocks.length > 0 ? blocks : [{ type: BlockType.PARAGRAPH, text: '' }];
}

