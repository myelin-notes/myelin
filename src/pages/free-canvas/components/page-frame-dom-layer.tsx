import { useEffect, useRef, useCallback } from "react";
import type { DrawableCanvas } from "../drawable-canvas";
import { PageFrameElement, PAGE_WIDTH, PAGE_HEIGHT, PAGE_PADDING, PAGE_CORNER_RADIUS } from "../elements/page-frame-element";
import type { EditableBlock } from "../elements/block-editor";
import { BlockTypeRegistry } from "../elements/block-types";
import { LINE_HEIGHT } from "../elements/text-layout";

// ── Style helpers ────────────────────────────────────────────

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

const PAGE_CHROME_STYLE: React.CSSProperties = {
    width: PAGE_WIDTH,
    minHeight: PAGE_HEIGHT,
    background: "#ffffff",
    borderRadius: PAGE_CORNER_RADIUS,
    boxShadow: "0 4px 24px rgba(25, 28, 30, 0.08)",
    border: "0.5px solid rgba(195, 199, 202, 0.2)",
    transformOrigin: "0 0",
    position: "absolute",
    left: 0,
    top: 0,
};

const CONTENT_STYLE: React.CSSProperties = {
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

// ── Serialization helpers ────────────────────────────────────

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
        const type = child.dataset.blockType || "p";
        // Get text content excluding bullet spans
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

// Properties where numeric values should remain unitless (same as React's behavior)
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

// ── Markdown shortcuts ───────────────────────────────────────

function checkMarkdownShortcut(div: HTMLDivElement): boolean {
    const text = div.textContent ?? "";
    for (const def of BlockTypeRegistry.all()) {
        const trigger = def.markdownTrigger;
        if (trigger && trigger.test(text)) {
            const newType = def.name;
            div.dataset.blockType = newType;
            Object.assign(div.style, flatStyle(BLOCK_STYLES[newType] ?? BLOCK_STYLES["p"]));

            // Clear content and set up for new block type
            div.innerHTML = "";
            if (newType === "li") {
                const bullet = document.createElement("span");
                bullet.contentEditable = "false";
                Object.assign(bullet.style, flatStyle(LI_BULLET_STYLE));
                bullet.innerHTML = '<svg width="5" height="5"><circle cx="2.5" cy="2.5" r="2.5" fill="#191c1e"/></svg>';
                div.appendChild(bullet);
            }
            div.appendChild(document.createElement("br"));

            // Place cursor in the now-empty block
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

// ── Handle Enter key for block continuation ──────────────────

function handleEnterKey(e: KeyboardEvent, container: HTMLDivElement): void {
    e.preventDefault();

    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;

    const range = sel.getRangeAt(0);

    // Find which block div contains the cursor
    let currentDiv: HTMLDivElement | null = null;
    let node: Node | null = range.startContainer;
    while (node && node !== container) {
        if (node instanceof HTMLDivElement && node.parentElement === container) {
            currentDiv = node;
            break;
        }
        node = node.parentNode;
    }
    if (!currentDiv) return;

    const blockType = currentDiv.dataset.blockType || "p";
    const def = BlockTypeRegistry.get(blockType);

    // Extract content after cursor into a document fragment
    const afterRange = document.createRange();
    afterRange.setStart(range.endContainer, range.endOffset);
    // Find the last text node (skip bullet spans)
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
    // Clean up: if the current block is now empty, add <br>
    const hasTextLeft = getBlockText(currentDiv).length > 0;
    if (!hasTextLeft) {
        // Remove any remaining empty text nodes
        for (let i = currentDiv.childNodes.length - 1; i >= 0; i--) {
            const child = currentDiv.childNodes[i];
            if (child instanceof HTMLElement && child.contentEditable === "false") continue;
            currentDiv.removeChild(child);
        }
        currentDiv.appendChild(document.createElement("br"));
    }

    // If current block is empty list item, convert to paragraph instead of continuing
    if (blockType === "li" && !hasTextLeft && getBlockText(currentDiv).length === 0) {
        currentDiv.dataset.blockType = "p";
        Object.assign(currentDiv.style, flatStyle(BLOCK_STYLES["p"]));
        // Remove bullet
        for (const child of Array.from(currentDiv.childNodes)) {
            if (child instanceof HTMLElement && child.contentEditable === "false") {
                child.remove();
            }
        }
        // Place cursor
        const newRange = document.createRange();
        newRange.selectNodeContents(currentDiv);
        newRange.collapse(true);
        sel.removeAllRanges();
        sel.addRange(newRange);
        return;
    }

    // Create new block
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

    // Add extracted content or <br> if empty
    const hasAfterContent = afterContent.textContent && afterContent.textContent.length > 0;
    if (hasAfterContent) {
        newDiv.appendChild(afterContent);
    } else {
        newDiv.appendChild(document.createElement("br"));
    }

    // Insert after current div
    if (currentDiv.nextSibling) {
        container.insertBefore(newDiv, currentDiv.nextSibling);
    } else {
        container.appendChild(newDiv);
    }

    // Place cursor at start of new block
    const newRange = document.createRange();
    // Skip bullet span if present
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

export function PageFrameDomLayer({ canvasRef, editingElement, onCommitEdit }: PageFrameDomLayerProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const frameRefsMap = useRef<Map<number, HTMLDivElement>>(new Map());
    const contentRefsMap = useRef<Map<number, HTMLDivElement>>(new Map());
    // Track block snapshots to avoid unnecessary DOM rebuilds
    const blockSnapshotsMap = useRef<Map<number, string>>(new Map());

    // Serialize and commit when exiting edit mode
    const commitEdit = useCallback(() => {
        if (!editingElement) return;
        const contentDiv = contentRefsMap.current.get(editingElement.index);
        if (contentDiv) {
            const blocks = domToBlocks(contentDiv);
            onCommitEdit(blocks);
        }
    }, [editingElement, onCommitEdit]);

    // Sync loop — runs every frame to create/remove/position DOM elements
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

                // Create DOM element if it doesn't exist yet
                if (!frameRefsMap.current.has(frame.index)) {
                    const frameDiv = document.createElement("div");
                    Object.assign(frameDiv.style, flatStyle(PAGE_CHROME_STYLE));
                    frameDiv.dataset.frameIndex = String(frame.index);

                    const contentDiv = document.createElement("div");
                    Object.assign(contentDiv.style, flatStyle(CONTENT_STYLE));
                    contentDiv.contentEditable = "false";

                    frameDiv.appendChild(contentDiv);
                    container.appendChild(frameDiv);

                    frameRefsMap.current.set(frame.index, frameDiv);
                    contentRefsMap.current.set(frame.index, contentDiv);

                    const blocks = frame.editor.blocks;
                    blocksToDOM(contentDiv, blocks);
                    blockSnapshotsMap.current.set(frame.index, JSON.stringify(blocks));
                } else if (editingRef.current?.index !== frame.index) {
                    // Refresh content if blocks changed (e.g. undo/redo)
                    const blocks = frame.editor.blocks;
                    const snap = JSON.stringify(blocks);
                    if (blockSnapshotsMap.current.get(frame.index) !== snap) {
                        const contentDiv = contentRefsMap.current.get(frame.index);
                        if (contentDiv) {
                            blocksToDOM(contentDiv, blocks);
                        }
                        blockSnapshotsMap.current.set(frame.index, snap);
                    }
                }

                // Position the frame div
                const div = frameRefsMap.current.get(frame.index)!;
                const worldX = frame.offset.x;
                const worldY = frame.offset.y;
                const screenX = (worldX + offset.x) * zoom;
                const screenY = (worldY + offset.y) * zoom;
                div.style.transform = `translate(${screenX}px, ${screenY}px) scale(${zoom})`;
            }

            // Remove divs for deleted frames
            for (const [index, div] of frameRefsMap.current) {
                if (!existingIndices.has(index)) {
                    div.remove();
                    frameRefsMap.current.delete(index);
                    contentRefsMap.current.delete(index);
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
            // Lower all frames back to non-editing state
            for (const [, contentDiv] of contentRefsMap.current) {
                contentDiv.contentEditable = "false";
                const frameDiv = contentDiv.parentElement as HTMLDivElement;
                if (frameDiv) {
                    frameDiv.style.zIndex = "";
                    frameDiv.style.pointerEvents = "";
                }
            }
            return;
        }

        const frameDiv = frameRefsMap.current.get(editingElement.index);
        const contentDiv = contentRefsMap.current.get(editingElement.index);
        if (!frameDiv || !contentDiv) return;

        // Raise above canvas
        frameDiv.style.zIndex = "10";
        frameDiv.style.pointerEvents = "auto";
        contentDiv.contentEditable = "true";

        // Register serialize callback so canvas can pull DOM blocks on exit
        const dc = canvasRef.current;
        if (dc) {
            dc.setGetEditingBlocks(() => domToBlocks(contentDiv));
        }

        // Focus and place cursor at end
        contentDiv.focus();
        const sel = window.getSelection();
        if (sel) {
            const range = document.createRange();
            range.selectNodeContents(contentDiv);
            range.collapse(false);
            sel.removeAllRanges();
            sel.addRange(range);
        }

        // Input handler for markdown shortcuts
        const handleInput = () => {
            const focusNode = window.getSelection()?.focusNode;
            if (!focusNode) return;
            let div: HTMLDivElement | null = null;
            let node: Node | null = focusNode;
            while (node && node !== contentDiv) {
                if (node instanceof HTMLDivElement && node.parentElement === contentDiv) {
                    div = node;
                    break;
                }
                node = node.parentNode;
            }
            if (div) {
                checkMarkdownShortcut(div);
            }
        };

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                commitEdit();
                return;
            }
            if (e.key === "Enter" && !e.shiftKey) {
                handleEnterKey(e, contentDiv);
                return;
            }
        };

        contentDiv.addEventListener("input", handleInput);
        contentDiv.addEventListener("keydown", handleKeyDown);

        // Show placeholder if empty
        updatePlaceholder(contentDiv, editingElement.editor.blocks.length === 0);

        return () => {
            contentDiv.removeEventListener("input", handleInput);
            contentDiv.removeEventListener("keydown", handleKeyDown);
        };
    }, [editingElement, commitEdit]);

    return (
        <div
            ref={containerRef}
            style={{
                position: "absolute",
                inset: 0,
                pointerEvents: "none",
                zIndex: 1,
                overflow: "hidden",
            }}
        />
    );
}

function updatePlaceholder(contentDiv: HTMLDivElement, isEmpty: boolean): void {
    if (isEmpty && contentDiv.children.length === 1) {
        const firstBlock = contentDiv.children[0] as HTMLDivElement;
        if (!firstBlock.dataset.placeholder) {
            firstBlock.dataset.placeholder = "true";
            firstBlock.setAttribute("data-ph", "Double-click to start writing...");
            Object.assign(firstBlock.style, {
                position: "relative",
            });
        }
    }
}
