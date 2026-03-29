import { BlockType, BlockTypeRegistry } from "../../elements/block-types";
import { getBlockStyle, getBlockText, readBlockType } from "./block-dom";

// ── Markdown shortcuts ───────────────────────────────────────

export function checkMarkdownShortcut(div: HTMLDivElement): boolean {
    const text = div.textContent ?? "";
    for (const [type, def] of BlockTypeRegistry.all()) {
        const trigger = def.markdownTrigger;
        if (trigger && trigger.test(text)) {
            div.dataset.blockType = String(type);
            Object.assign(div.style, getBlockStyle(type));

            div.innerHTML = "";
            const decoration = def.createDecoration();
            if (decoration) {
                div.appendChild(decoration);
            }
            div.appendChild(document.createElement("br"));

            const sel = window.getSelection();
            if (sel) {
                const range = document.createRange();
                range.selectNodeContents(div);
                range.collapse(false);
                sel.removeAllRanges();
                sel.addRange(range);
            }
            return true;
        }
    }
    return false;
}

// ── Enter key ────────────────────────────────────────────────

export function handleEnterKey(e: KeyboardEvent, container: HTMLDivElement): void {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;

    const range = sel.getRangeAt(0);

    let currentDiv: HTMLDivElement | null = null;
    let node: Node | null = range.startContainer;
    while (node && node !== container) {
        if (node instanceof HTMLDivElement && node.parentElement === container && !node.dataset.pageBreak) {
            currentDiv = node;
            break;
        }
        node = node.parentNode;
    }
    if (!currentDiv) return;

    e.preventDefault();

    const blockType = readBlockType(currentDiv);
    const def = BlockTypeRegistry.get(blockType);

    const afterRange = document.createRange();
    afterRange.setStart(range.endContainer, range.endOffset);
    let lastTextNode: Node | null = null;
    for (let i = currentDiv.childNodes.length - 1; i >= 0; i--) {
        const child = currentDiv.childNodes[i];
        if (child instanceof HTMLElement && child.contentEditable === "false") continue;
        lastTextNode = child;
        break;
    }
    if (lastTextNode) {
        if (lastTextNode instanceof Text) {
            afterRange.setEnd(lastTextNode, lastTextNode.length);
        } else {
            afterRange.setEndAfter(lastTextNode);
        }
    } else {
        afterRange.setEndAfter(currentDiv.lastChild ?? currentDiv);
    }

    const afterContent = afterRange.extractContents();
    const hasTextLeft = getBlockText(currentDiv).length > 0;
    if (!hasTextLeft) {
        for (let i = currentDiv.childNodes.length - 1; i >= 0; i--) {
            const child = currentDiv.childNodes[i];
            if (child instanceof HTMLElement && child.contentEditable === "false") continue;
            currentDiv.removeChild(child);
        }
        currentDiv.appendChild(document.createElement("br"));
    }

    // Empty continuing block (e.g., empty list item) reverts to paragraph
    if (def.continuesOnEnter && !hasTextLeft) {
        currentDiv.dataset.blockType = String(BlockType.PARAGRAPH);
        Object.assign(currentDiv.style, getBlockStyle(BlockType.PARAGRAPH));
        for (const child of Array.from(currentDiv.childNodes)) {
            if (child instanceof HTMLElement && child.contentEditable === "false") {
                child.remove();
            }
        }
        const newRange = document.createRange();
        newRange.selectNodeContents(currentDiv);
        newRange.collapse(true);
        sel.removeAllRanges();
        sel.addRange(newRange);
        return;
    }

    const newType = def.continuesOnEnter ? blockType : BlockType.PARAGRAPH;
    const newDef = BlockTypeRegistry.get(newType);
    const newDiv = document.createElement("div");
    newDiv.dataset.blockType = String(newType);
    Object.assign(newDiv.style, getBlockStyle(newType));

    const decoration = newDef.createDecoration();
    if (decoration) {
        newDiv.appendChild(decoration);
    }

    const hasAfterContent = afterContent.textContent && afterContent.textContent.length > 0;
    if (hasAfterContent) {
        newDiv.appendChild(afterContent);
    } else {
        newDiv.appendChild(document.createElement("br"));
    }

    // Insert after current div, skipping any page-break spacer
    let insertBefore = currentDiv.nextSibling;
    while (insertBefore instanceof HTMLDivElement && insertBefore.dataset.pageBreak) {
        insertBefore = insertBefore.nextSibling;
    }
    if (insertBefore) {
        container.insertBefore(newDiv, insertBefore);
    } else {
        container.appendChild(newDiv);
    }

    const newRange = document.createRange();
    let targetNode: Node = newDiv;
    for (const child of newDiv.childNodes) {
        if (child instanceof HTMLElement && child.contentEditable === "false") continue;
        targetNode = child;
        break;
    }
    if (targetNode instanceof Text) {
        newRange.setStart(targetNode, 0);
    } else {
        newRange.selectNodeContents(newDiv);
        newRange.collapse(true);
    }
    newRange.collapse(true);
    sel.removeAllRanges();
    sel.addRange(newRange);
}
