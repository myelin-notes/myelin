import { DrawableElement } from "./drawable-element";
import { ElementType } from "./element-type";
import { BinaryReader, BinaryWriter } from "../../../lib/utils/binary-helper";
import { BlockEditor } from "./block-editor";
import { BlockTypeRegistry } from "./block-types";
import { wrapTextForLayout, LINE_HEIGHT } from "./text-layout";
import type { LayoutLine } from "./text-layout";

// Re-export for external consumers
export type { EditableBlock, CursorPos } from "./block-editor";

const PAGE_WIDTH = 680;
const PAGE_HEIGHT = 880;
const PAGE_PADDING = 48;
const PAGE_GAP = 40;
const PAGE_CORNER_RADIUS = 3;
const CURSOR_BLINK_RATE = 1.06;

export class PageFrameElement extends DrawableElement {
    private _pageWidth = PAGE_WIDTH;
    private _pageHeight = PAGE_HEIGHT;
    private _editing = false;
    private _cursorBlink = 0;
    private _numPages = 1;

    public readonly editor = new BlockEditor();

    constructor(index: number) {
        super(index, ElementType.PAGE_FRAME);
    }

    public get editing(): boolean { return this._editing; }
    public get pageWidth(): number { return this._pageWidth; }
    public get pageHeight(): number { return this._pageHeight; }

    public get localBoundingBox(): DOMRect {
        const n = this._numPages;
        const totalHeight = n * this._pageHeight + Math.max(0, n - 1) * PAGE_GAP;
        return new DOMRect(0, 0, this._pageWidth, totalHeight);
    }

    protected isOverLocal(x: number, y: number, _radius: number, _ctx: CanvasRenderingContext2D): boolean {
        if (x < 0 || x > this._pageWidth) return false;
        for (let p = 0; p < this._numPages; p++) {
            const pageTop = p * (this._pageHeight + PAGE_GAP);
            if (y >= pageTop && y <= pageTop + this._pageHeight) return true;
        }
        return false;
    }

    protected updateBoundingBox(): void {}

    // ── Edit lifecycle ───────────────────────────────────────────

    public enterEditMode(): void {
        this._editing = true;
        this.editor.resetCursorToEnd();
        this._cursorBlink = 0;
    }

    public exitEditMode(): void {
        this._editing = false;
        this.editor.trimTrailingEmpty();
    }

    // ── Layout ───────────────────────────────────────────────────

    private computeLayout(ctx: CanvasRenderingContext2D): LayoutLine[] {
        const contentWidth = this._pageWidth - PAGE_PADDING * 2;
        const contentHeight = this._pageHeight - PAGE_PADDING * 2;
        const blocks = this.editor.blocks;
        const layoutLines: LayoutLine[] = [];

        let currentPage = 0;
        let yInPage = 0;

        for (let bi = 0; bi < blocks.length; bi++) {
            const block = blocks[bi];
            const def = BlockTypeRegistry.get(block.type);
            const { style } = def;
            ctx.font = style.font;

            const wrapped = wrapTextForLayout(ctx, block.text, contentWidth - style.indent);

            for (const wl of wrapped) {
                const lineHeight = style.size * LINE_HEIGHT;

                if (yInPage + lineHeight > contentHeight && yInPage > 0) {
                    currentPage++;
                    yInPage = 0;
                }

                const absY = currentPage * (this._pageHeight + PAGE_GAP) + PAGE_PADDING + yInPage;

                layoutLines.push({
                    blockIndex: bi,
                    startOffset: wl.startOffset,
                    text: wl.text,
                    x: PAGE_PADDING + style.indent,
                    y: absY,
                    height: lineHeight,
                    font: style.font,
                });

                yInPage += lineHeight;
            }

            yInPage += style.size * 0.4;
        }

        this._numPages = currentPage + 1;
        return layoutLines;
    }

    // ── Drawing ──────────────────────────────────────────────────

    protected draw2D(ctx: CanvasRenderingContext2D, deltaTime: number): void {
        if (this._editing) {
            this._cursorBlink += deltaTime;
        }

        const hasBlocks = this.editor.blocks.length > 0;
        let layoutLines: LayoutLine[] = [];

        if (hasBlocks) {
            layoutLines = this.computeLayout(ctx);
        } else {
            this._numPages = 1;
        }

        // Draw each page's white background
        for (let p = 0; p < this._numPages; p++) {
            this.drawPageChrome(ctx, p * (this._pageHeight + PAGE_GAP));
        }

        // Draw content on top
        if (hasBlocks) {
            this.editor.setLayoutLines(layoutLines);
            this.drawContent(ctx, layoutLines);
        } else if (!this._editing) {
            this.drawPlaceholder(ctx);
        } else {
            const style = BlockTypeRegistry.get("p").style;
            this.drawCursorLine(ctx, PAGE_PADDING, PAGE_PADDING, style.size * LINE_HEIGHT);
        }
    }

    private drawPageChrome(ctx: CanvasRenderingContext2D, pageY: number): void {
        ctx.save();
        ctx.shadowColor = "rgba(25, 28, 30, 0.08)";
        ctx.shadowBlur = 24;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 4;
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.roundRect(0, pageY, this._pageWidth, this._pageHeight, PAGE_CORNER_RADIUS);
        ctx.fill();
        ctx.restore();

        ctx.strokeStyle = "rgba(195, 199, 202, 0.2)";
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.roundRect(0, pageY, this._pageWidth, this._pageHeight, PAGE_CORNER_RADIUS);
        ctx.stroke();
    }

    private drawContent(ctx: CanvasRenderingContext2D, layoutLines: LayoutLine[]): void {
        const contentWidth = this._pageWidth - PAGE_PADDING * 2;
        const cursor = this.editor.cursor;
        const blocks = this.editor.blocks;
        let cursorDrawn = false;

        ctx.textBaseline = "top";

        for (let p = 0; p < this._numPages; p++) {
            const pageTop = p * (this._pageHeight + PAGE_GAP);
            const contentTop = pageTop + PAGE_PADDING;
            const contentBottom = pageTop + this._pageHeight - PAGE_PADDING;

            ctx.save();
            ctx.beginPath();
            ctx.rect(PAGE_PADDING, contentTop, contentWidth, this._pageHeight - PAGE_PADDING * 2);
            ctx.clip();

            let prevBlockIndex = -1;

            for (const line of layoutLines) {
                if (line.y < contentTop || line.y >= contentBottom) continue;

                const block = blocks[line.blockIndex];
                const def = BlockTypeRegistry.get(block.type);
                ctx.font = line.font;

                // Draw block decoration on first line of each block
                if (line.blockIndex !== prevBlockIndex) {
                    def.drawDecoration(ctx, PAGE_PADDING, line.y);
                    prevBlockIndex = line.blockIndex;
                }

                ctx.fillStyle = def.style.color;
                if (line.text) {
                    ctx.fillText(line.text, line.x, line.y);
                }

                if (this._editing && line.blockIndex === cursor.block && !cursorDrawn) {
                    const cursorInLine = cursor.offset - line.startOffset;
                    if (cursorInLine >= 0 && cursorInLine <= line.text.length) {
                        const cursorX = line.x + ctx.measureText(line.text.slice(0, cursorInLine)).width;
                        if (this.editor.desiredX < 0) this.editor.desiredX = cursorX;
                        this.drawCursorLine(ctx, cursorX, line.y, line.height);
                        cursorDrawn = true;
                    }
                }
            }

            ctx.restore();
        }

        if (this._editing && !cursorDrawn && blocks.length > 0) {
            const style = BlockTypeRegistry.get(blocks[0].type).style;
            this.drawCursorLine(ctx, PAGE_PADDING + style.indent, PAGE_PADDING, style.size * LINE_HEIGHT);
        }
    }

    private drawPlaceholder(ctx: CanvasRenderingContext2D): void {
        ctx.fillStyle = "rgba(100, 116, 139, 0.3)";
        ctx.font = '16px "Inter", sans-serif';
        ctx.textBaseline = "top";
        ctx.fillText("Double-click to start writing...", PAGE_PADDING, PAGE_PADDING);
    }

    private drawCursorLine(ctx: CanvasRenderingContext2D, x: number, y: number, height: number): void {
        const phase = this._cursorBlink % CURSOR_BLINK_RATE;
        if (phase > CURSOR_BLINK_RATE / 2) return;

        ctx.fillStyle = "#2f3e46";
        ctx.fillRect(x - 0.75, y, 1.5, height);
    }

    // ── Serialization ────────────────────────────────────────────

    public save(writer: BinaryWriter): void {
        super.save(writer);
        writer.writeF32(this._pageWidth);
        writer.writeF32(this._pageHeight);
        const blocks = this.editor.blocks;
        writer.writeU32(blocks.length);
        for (const block of blocks) {
            writer.writeU8(BlockTypeRegistry.get(block.type).id);
            writer.writeString(block.text);
        }
    }

    public load(reader: BinaryReader): void {
        super.load(reader);
        this._pageWidth = reader.readF32();
        this._pageHeight = reader.readF32();
        const count = reader.readU32();
        const blocks = [];
        for (let i = 0; i < count; i++) {
            const typeId = reader.readU8();
            const text = reader.readString();
            blocks.push({ type: BlockTypeRegistry.getById(typeId).name, text });
        }
        this.editor.setBlocks(blocks);
    }
}
