import { PAGE_WIDTH, PAGE_HEIGHT, PAGE_PADDING, PAGE_GAP, PAGE_CORNER_RADIUS, type PageFrameElement } from "../../elements/page-frame-element";
import { flatStyle } from "./flat-style";

// ── Constants ───────────────────────────────────────────────

const CONTENT_HEIGHT = PAGE_HEIGHT - PAGE_PADDING * 2;
const PAGE_BREAK_GAP = PAGE_PADDING + PAGE_GAP + PAGE_PADDING;

// ── Style constants ─────────────────────────────────────────

export const FRAME_STYLE: React.CSSProperties = {
    transformOrigin: "0 0",
    position: "absolute",
    left: 0,
    top: 0,
    width: PAGE_WIDTH,
    overflow: "hidden",
};

export const PAGE_CHROME_CSS = flatStyle({
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

export const CONTENT_STYLE: React.CSSProperties = {
    position: "relative",
    padding: PAGE_PADDING,
    outline: "none",
};

// ── Types ───────────────────────────────────────────────────

export interface FrameRefs {
    frameDiv: HTMLDivElement;
    contentDiv: HTMLDivElement;
    chromeDivs: HTMLDivElement[];
}

// ── Pagination ──────────────────────────────────────────────

export function paginateFrame(refs: FrameRefs, frame: PageFrameElement): void {
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
