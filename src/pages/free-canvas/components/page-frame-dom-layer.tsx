import { useEffect, useRef, useCallback } from "react";
import type { DrawableCanvas } from "../drawable-canvas";
import { PageFrameElement, PAGE_WIDTH, PAGE_HEIGHT, PAGE_PADDING, PAGE_GAP, PAGE_CORNER_RADIUS } from "../elements/page-frame-element";
import type { EditableBlock } from "../elements/block-editor";
import { BlockTypeRegistry } from "../elements/block-types";
import { LINE_HEIGHT } from "../elements/text-layout";

// ── Utilities ────────────────────────────────────────────────

const UNITLESS = new Set([
    "lineHeight", "opacity", "zIndex", "fontWeight", "flex", "order",
    "flexGrow", "flexShrink", "columnCount", "orphans", "widows",
]);

function flatStyle(style: React.CSSProperties): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(style)) {
        if (value === undefined) continue;
        if (typeof value === "number" && !UNITLESS.has(key)) {
            result[key] = value + "px";
        } else {
            result[key] = String(value);
        }
    }
    return result;
}

// ── Style constants ──────────────────────────────────────────

const CONTENT_HEIGHT = PAGE_HEIGHT - PAGE_PADDING * 2; // 784px usable per page
const PAGE_BREAK_GAP = PAGE_PADDING + PAGE_GAP + PAGE_PADDING; // 136px between content areas

const BLOCK_STYLES: Record<string, React.CSSProperties> = {};

for (const def of BlockTypeRegistry.all()) {
    const s = def.style;
    const base: React.CSSProperties = {
        font: s.font,
        color: s.color,
        lineHeight: LINE_HEIGHT,
        paddingLeft: s.indent > 0 ? s.indent : undefined,
        marginBottom: s.size * 0.4,
        outline: "none",
        minHeight: s.size * LINE_HEIGHT,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
    };

    if (def.name === "li") {
        base.position = "relative";
    }
    if (def.name === "blockquote") {
        base.borderLeft = "3px solid rgba(195, 199, 202, 0.5)";
        base.paddingLeft = s.indent;
    }

    BLOCK_STYLES[def.name] = base;
}

// Frame div: transparent container, explicit height set by pagination
const FRAME_STYLE: React.CSSProperties = {
    transformOrigin: "0 0",
    position: "absolute",
    left: 0,
    top: 0,
    width: PAGE_WIDTH,
    overflow: "hidden",
};

// Individual page chrome card
const PAGE_CHROME_CSS = flatStyle({
    position: "absolute",
    left: 0,
    width: PAGE_WIDTH,
    height: PAGE_HEIGHT,
    background: "#ffffff",
    borderRadius: PAGE_CORNER_RADIUS,
    boxShadow: "0 4px 24px rgba(25, 28, 30, 0.08)",
    border: "0.5px solid rgba(195, 199, 202, 0.2)",
    pointerEvents: "none",
} as React.CSSProperties);

const CONTENT_STYLE: React.CSSProperties = {
    position: "relative",
    padding: PAGE_PADDING,
    outline: "none",
};

const LI_BULLET_STYLE: React.CSSProperties = {
    position: "absolute",
    left: 0,
    top: 0,
    width: 24,
    height: "1.5em",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    pointerEvents: "none",
};

// ── DOM helpers ──────────────────────────────────────────────

function blocksToDOM(container: HTMLDivElement, blocks: EditableBlock[]): void {
    container.innerHTML = "";
    if (blocks.length === 0) {
        const div = document.createElement("div");
        div.dataset.blockType = "p";
        Object.assign(div.style, flatStyle(BLOCK_STYLES["p"]));
        div.appendChild(document.createElement("br"));
        container.appendChild(div);
        return;
    }
    for (const block of blocks) {
        container.appendChild(createBlockElement(block));
    }
}

function createBlockElement(block: EditableBlock): HTMLDivElement {
    const div = document.createElement("div");
    div.dataset.blockType = block.type;
    Object.assign(div.style, flatStyle(BLOCK_STYLES[block.type] ?? BLOCK_STYLES["p"]));

    if (block.type === "li") {
        const bullet = document.createElement("span");
        bullet.contentEditable = "false";
        Object.assign(bullet.style, flatStyle(LI_BULLET_STYLE));
        bullet.innerHTML = '<svg width="5" height="5"><circle cx="2.5" cy="2.5" r="2.5" fill="#191c1e"/></svg>';
        div.appendChild(bullet);
    }

    if (block.text) {
        div.appendChild(document.createTextNode(block.text));
    } else {
        div.appendChild(document.createElement("br"));
    }
    return div;
}

function domToBlocks(container: HTMLDivElement): EditableBlock[] {
    const blocks: EditableBlock[] = [];
    for (const child of container.children) {
        if (!(child instanceof HTMLDivElement)) continue;
        if (child.dataset.pageBreak) continue; // skip spacers
        const type = child.dataset.blockType || "p";
        let text = "";
        for (const node of child.childNodes) {
            if (node instanceof HTMLElement && node.contentEditable === "false") continue;
            if (node instanceof HTMLBRElement) continue;
            text += node.textContent ?? "";
        }
        blocks.push({ type, text });
    }
    return blocks.length > 0 ? blocks : [{ type: "p", text: "" }];
}

// ── Pagination ───────────────────────────────────────────────

function paginateFrame(refs: FrameRefs, frame: PageFrameElement): void {
    const contentDiv = refs.contentDiv;

    // Remove old spacers
    for (const el of Array.from(contentDiv.querySelectorAll("[data-page-break]"))) {
        el.remove();
    }

    // Measure blocks and determine page breaks
    const blocks = Array.from(contentDiv.children) as HTMLElement[];
    let yInPage = 0;
    let pageCount = 1;
    const spacerInsertions: { before: HTMLElement; height: number }[] = [];

    for (const block of blocks) {
        const style = getComputedStyle(block);
        const blockHeight = block.offsetHeight
            + parseFloat(style.marginTop)
            + parseFloat(style.marginBottom);

        if (yInPage + blockHeight > CONTENT_HEIGHT && yInPage > 0) {
            const remaining = CONTENT_HEIGHT - yInPage;
            spacerInsertions.push({ before: block, height: remaining + PAGE_BREAK_GAP });
            pageCount++;
            yInPage = blockHeight;
        } else {
            yInPage += blockHeight;
        }
    }

    // Insert spacers (reverse order to preserve DOM positions)
    for (let i = spacerInsertions.length - 1; i >= 0; i--) {
        const { before, height } = spacerInsertions[i];
        const spacer = document.createElement("div");
        spacer.dataset.pageBreak = "true";
        spacer.contentEditable = "false";
        spacer.style.height = height + "px";
        spacer.style.pointerEvents = "none";
        spacer.style.userSelect = "none";
        spacer.style.flexShrink = "0";
        contentDiv.insertBefore(spacer, before);
    }

    // Update page count on the element (for bounding box / hit testing)
    frame.numPages = pageCount;

    // Set explicit height on the frame div so it doesn't overflow
    const totalHeight = frame.totalHeight;
    refs.frameDiv.style.height = totalHeight + "px";

    // Sync chrome cards
    while (refs.chromeDivs.length < pageCount) {
        const chrome = document.createElement("div");
        Object.assign(chrome.style, PAGE_CHROME_CSS);
        refs.frameDiv.insertBefore(chrome, refs.contentDiv);
        refs.chromeDivs.push(chrome);
    }
    while (refs.chromeDivs.length > pageCount) {
        refs.chromeDivs.pop()!.remove();
    }
    for (let p = 0; p < pageCount; p++) {
        refs.chromeDivs[p].style.top = (p * (PAGE_HEIGHT + PAGE_GAP)) + "px";
    }
}

// ── Markdown shortcuts ───────────────────────────────────────

function checkMarkdownShortcut(div: HTMLDivElement): boolean {
    const text = div.textContent ?? "";
    for (const def of BlockTypeRegistry.all()) {
        const trigger = def.markdownTrigger;
        if (trigger && trigger.test(text)) {
            const newType = def.name;
            div.dataset.blockType = newType;
            Object.assign(div.style, flatStyle(BLOCK_STYLES[newType] ?? BLOCK_STYLES["p"]));

            div.innerHTML = "";
            if (newType === "li") {
                const bullet = document.createElement("span");
                bullet.contentEditable = "false";
                Object.assign(bullet.style, flatStyle(LI_BULLET_STYLE));
                bullet.innerHTML = '<svg width="5" height="5"><circle cx="2.5" cy="2.5" r="2.5" fill="#191c1e"/></svg>';
                div.appendChild(bullet);
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

function handleEnterKey(e: KeyboardEvent, container: HTMLDivElement): void {
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

    const blockType = currentDiv.dataset.blockType || "p";
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

    if (blockType === "li" && !hasTextLeft) {
        currentDiv.dataset.blockType = "p";
        Object.assign(currentDiv.style, flatStyle(BLOCK_STYLES["p"]));
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

    const newType = def.continuesOnEnter ? blockType : "p";
    const newDiv = document.createElement("div");
    newDiv.dataset.blockType = newType;
    Object.assign(newDiv.style, flatStyle(BLOCK_STYLES[newType] ?? BLOCK_STYLES["p"]));

    if (newType === "li") {
        const bullet = document.createElement("span");
        bullet.contentEditable = "false";
        Object.assign(bullet.style, flatStyle(LI_BULLET_STYLE));
        bullet.innerHTML = '<svg width="5" height="5"><circle cx="2.5" cy="2.5" r="2.5" fill="#191c1e"/></svg>';
        newDiv.appendChild(bullet);
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

function getBlockText(div: HTMLDivElement): string {
    let text = "";
    for (const node of div.childNodes) {
        if (node instanceof HTMLElement && node.contentEditable === "false") continue;
        if (node instanceof HTMLBRElement) continue;
        text += node.textContent ?? "";
    }
    return text;
}

// ── Component ────────────────────────────────────────────────

interface PageFrameDomLayerProps {
    canvasRef: React.RefObject<DrawableCanvas | null>;
    editingElement: PageFrameElement | null;
    onCommitEdit: (blocks: EditableBlock[]) => void;
}

interface FrameRefs {
    frameDiv: HTMLDivElement;
    contentDiv: HTMLDivElement;
    chromeDivs: HTMLDivElement[];
}

export function PageFrameDomLayer({ canvasRef, editingElement, onCommitEdit }: PageFrameDomLayerProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const frameMap = useRef<Map<number, FrameRefs>>(new Map());
    const blockSnapshotsMap = useRef<Map<number, string>>(new Map());

    const commitEdit = useCallback(() => {
        if (!editingElement) return;
        const refs = frameMap.current.get(editingElement.index);
        if (refs) {
            const blocks = domToBlocks(refs.contentDiv);
            onCommitEdit(blocks);
        }
    }, [editingElement, onCommitEdit]);

    // Sync loop — every frame: create/remove/position frame DOM elements
    useEffect(() => {
        let rafId: number;
        const editingRef = { current: editingElement };
        editingRef.current = editingElement;

        function sync() {
            const dc = canvasRef.current;
            const container = containerRef.current;
            if (!dc || !container) {
                rafId = requestAnimationFrame(sync);
                return;
            }

            const zoom = dc.zoom;
            const offset = dc.viewOffset;
            const frames = dc.pageFrames;
            const existingIndices = new Set<number>();

            for (const frame of frames) {
                existingIndices.add(frame.index);

                if (!frameMap.current.has(frame.index)) {
                    const frameDiv = document.createElement("div");
                    Object.assign(frameDiv.style, flatStyle(FRAME_STYLE));
                    frameDiv.dataset.frameIndex = String(frame.index);

                    const contentDiv = document.createElement("div");
                    Object.assign(contentDiv.style, flatStyle(CONTENT_STYLE));
                    contentDiv.contentEditable = "false";

                    frameDiv.appendChild(contentDiv);
                    container.appendChild(frameDiv);

                    const refs: FrameRefs = { frameDiv, contentDiv, chromeDivs: [] };
                    frameMap.current.set(frame.index, refs);

                    const blocks = frame.editor.blocks;
                    blocksToDOM(contentDiv, blocks);
                    blockSnapshotsMap.current.set(frame.index, JSON.stringify(blocks));

                    paginateFrame(refs, frame);
                } else if (editingRef.current?.index !== frame.index) {
                    const blocks = frame.editor.blocks;
                    const snap = JSON.stringify(blocks);
                    if (blockSnapshotsMap.current.get(frame.index) !== snap) {
                        const refs = frameMap.current.get(frame.index)!;
                        blocksToDOM(refs.contentDiv, blocks);
                        blockSnapshotsMap.current.set(frame.index, snap);
                        paginateFrame(refs, frame);
                    }
                }

                // Position
                const refs = frameMap.current.get(frame.index)!;
                const screenX = (frame.offset.x + offset.x) * zoom;
                const screenY = (frame.offset.y + offset.y) * zoom;
                refs.frameDiv.style.transform = `translate(${screenX}px, ${screenY}px) scale(${zoom})`;
            }

            for (const [index, refs] of frameMap.current) {
                if (!existingIndices.has(index)) {
                    refs.frameDiv.remove();
                    frameMap.current.delete(index);
                    blockSnapshotsMap.current.delete(index);
                }
            }

            rafId = requestAnimationFrame(sync);
        }

        rafId = requestAnimationFrame(sync);
        return () => cancelAnimationFrame(rafId);
    }, [canvasRef, editingElement]);

    // Handle editing state changes
    useEffect(() => {
        if (!editingElement) {
            for (const [, refs] of frameMap.current) {
                refs.contentDiv.contentEditable = "false";
                refs.frameDiv.style.zIndex = "";
                refs.frameDiv.style.pointerEvents = "";
            }
            return;
        }

        const refs = frameMap.current.get(editingElement.index);
        if (!refs) return;

        refs.frameDiv.style.zIndex = "10";
        refs.frameDiv.style.pointerEvents = "auto";
        refs.contentDiv.contentEditable = "true";

        const dc = canvasRef.current;
        if (dc) {
            dc.setGetEditingBlocks(() => domToBlocks(refs.contentDiv));
        }

        // Focus and place cursor at end of the last block
        refs.contentDiv.focus();
        const sel = window.getSelection();
        if (sel && refs.contentDiv.lastElementChild) {
            const lastBlock = refs.contentDiv.lastElementChild;
            const range = document.createRange();
            range.selectNodeContents(lastBlock);
            range.collapse(false);
            sel.removeAllRanges();
            sel.addRange(range);
        }

        const repaginate = () => paginateFrame(refs, editingElement);

        const handleInput = () => {
            const focusNode = window.getSelection()?.focusNode;
            if (focusNode) {
                let div: HTMLDivElement | null = null;
                let n: Node | null = focusNode;
                while (n && n !== refs.contentDiv) {
                    if (n instanceof HTMLDivElement && n.parentElement === refs.contentDiv) {
                        div = n;
                        break;
                    }
                    n = n.parentNode;
                }
                if (div) checkMarkdownShortcut(div);
            }
            repaginate();
        };

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                commitEdit();
                return;
            }
            if (e.key === "Enter" && !e.shiftKey) {
                handleEnterKey(e, refs.contentDiv);
                repaginate();
                return;
            }
        };

        refs.contentDiv.addEventListener("input", handleInput);
        refs.contentDiv.addEventListener("keydown", handleKeyDown);

        repaginate();

        return () => {
            refs.contentDiv.removeEventListener("input", handleInput);
            refs.contentDiv.removeEventListener("keydown", handleKeyDown);
        };
    }, [editingElement, commitEdit, canvasRef]);

    return (
        <div
            ref={containerRef}
            style={{
                position: "absolute",
                inset: 0,
                pointerEvents: "none",
                overflow: "hidden",
            }}
        />
    );
}
