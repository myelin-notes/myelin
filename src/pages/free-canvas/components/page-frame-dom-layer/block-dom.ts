import type { EditableBlock } from "../../elements/block-editor";
import { BlockType, BlockTypeRegistry } from "../../elements/block-types";
import { LINE_HEIGHT } from "../../elements/text-layout";
import { flatStyle } from "./flat-style";

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
        outline: "none",
        minHeight: s.size * LINE_HEIGHT,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
    });
}

export function getBlockStyle(type: BlockType): Record<string, string> {
    const base = flatStyle(BLOCK_BASE_STYLES.get(type) ?? BLOCK_BASE_STYLES.get(BlockType.PARAGRAPH)!);
    const def = BlockTypeRegistry.get(type);
    const css = def.style.css ? flatStyle(def.style.css) : {};
    return { ...base, ...css };
}

// ── DOM helpers ─────────────────────────────────────────────

export function readBlockType(div: HTMLElement): BlockType {
    const raw = div.dataset.blockType;
    return raw !== undefined ? Number(raw) as BlockType : BlockType.PARAGRAPH;
}

// ── DOM conversion ──────────────────────────────────────────

export function blocksToDOM(container: HTMLDivElement, blocks: EditableBlock[]): void {
    container.innerHTML = "";
    if (blocks.length === 0) {
        const div = document.createElement("div");
        div.dataset.blockType = String(BlockType.PARAGRAPH);
        Object.assign(div.style, getBlockStyle(BlockType.PARAGRAPH));
        div.appendChild(document.createElement("br"));
        container.appendChild(div);
        return;
    }
    for (const block of blocks) {
        container.appendChild(createBlockElement(block));
    }
}

export function createBlockElement(block: EditableBlock): HTMLDivElement {
    const def = BlockTypeRegistry.get(block.type);
    const div = document.createElement("div");
    div.dataset.blockType = String(block.type);
    Object.assign(div.style, getBlockStyle(block.type));

    const decoration = def.createDecoration();
    if (decoration) {
        div.appendChild(decoration);
    }

    if (block.text) {
        div.appendChild(document.createTextNode(block.text));
    } else {
        div.appendChild(document.createElement("br"));
    }
    return div;
}

export function domToBlocks(container: HTMLDivElement): EditableBlock[] {
    const blocks: EditableBlock[] = [];
    for (const child of container.children) {
        if (!(child instanceof HTMLDivElement)) continue;
        if (child.dataset.pageBreak) continue;
        const type = readBlockType(child);
        let text = "";
        for (const node of child.childNodes) {
            if (node instanceof HTMLElement && node.contentEditable === "false") continue;
            if (node instanceof HTMLBRElement) continue;
            text += node.textContent ?? "";
        }
        blocks.push({ type, text });
    }
    return blocks.length > 0 ? blocks : [{ type: BlockType.PARAGRAPH, text: "" }];
}

export function getBlockText(div: HTMLDivElement): string {
    let text = "";
    for (const node of div.childNodes) {
        if (node instanceof HTMLElement && node.contentEditable === "false") continue;
        if (node instanceof HTMLBRElement) continue;
        text += node.textContent ?? "";
    }
    return text;
}
