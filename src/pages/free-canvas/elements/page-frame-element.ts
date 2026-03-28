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
const PAGE_CORNER_RADIUS = 3;
const CURSOR_BLINK_RATE = 1.06;

export class PageFrameElement extends DrawableElement {
    private _pageWidth = PAGE_WIDTH;
    private _pageHeight = PAGE_HEIGHT;
    private _editing = false;
    private _cursorBlink = 0;

    public readonly editor = new BlockEditor();

    constructor(index: number) {
        super(index, ElementType.PAGE_FRAME);
    }

    public get editing(): boolean { return this._editing; }
    public get pageWidth(): number { return this._pageWidth; }
    public get pageHeight(): number { return this._pageHeight; }

    public get localBoundingBox(): DOMRect {
        return new DOMRect(0, 0, this._pageWidth, this._pageHeight);
    }

    protected isOverLocal(x: number, y: number, _radius: number, _ctx: CanvasRenderingContext2D): boolean {
        return x >= 0 && x <= this._pageWidth && y >= 0 && y <= this._pageHeight;
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

    // ── Drawing ──────────────────────────────────────────────────

    protected draw2D(ctx: CanvasRenderingContext2D, deltaTime: number): void {
        this.drawPageChrome(ctx);

        if (this._editing) {
            this._cursorBlink += deltaTime;
        }

        if (this.editor.blocks.length > 0) {
            this.drawBlocks(ctx, this._editing);
        } else if (!this._editing) {
            this.drawPlaceholder(ctx);
        } else {
            const style = BlockTypeRegistry.get("p").style;
            this.drawCursorLine(ctx, PAGE_PADDING, PAGE_PADDING, style.size * LINE_HEIGHT);
        }
    }

    private drawPageChrome(ctx: CanvasRenderingContext2D): void {
        ctx.save();
        ctx.shadowColor = "rgba(25, 28, 30, 0.08)";
        ctx.shadowBlur = 24;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 4;
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.roundRect(0, 0, this._pageWidth, this._pageHeight, PAGE_CORNER_RADIUS);
        ctx.fill();
        ctx.restore();

        ctx.strokeStyle = "rgba(195, 199, 202, 0.2)";
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.roundRect(0, 0, this._pageWidth, this._pageHeight, PAGE_CORNER_RADIUS);
        ctx.stroke();
    }

    private drawPlaceholder(ctx: CanvasRenderingContext2D): void {
        ctx.fillStyle = "rgba(100, 116, 139, 0.3)";
        ctx.font = '16px "Inter", sans-serif';
        ctx.textBaseline = "top";
        ctx.fillText("Double-click to start writing...", PAGE_PADDING, PAGE_PADDING);
    }

    private drawBlocks(ctx: CanvasRenderingContext2D, withCursor: boolean): void {
        const contentWidth = this._pageWidth - PAGE_PADDING * 2;
        const blocks = this.editor.blocks;
        const cursor = this.editor.cursor;
        const layoutLines: LayoutLine[] = [];

        ctx.save();
        ctx.beginPath();
        ctx.rect(PAGE_PADDING, PAGE_PADDING, contentWidth, this._pageHeight - PAGE_PADDING * 2);
        ctx.clip();
        ctx.textBaseline = "top";

        let y = PAGE_PADDING;
        let cursorDrawn = false;

        for (let bi = 0; bi < blocks.length; bi++) {
            if (y > this._pageHeight - PAGE_PADDING) break;

            const block = blocks[bi];
            const def = BlockTypeRegistry.get(block.type);
            const { style } = def;
            ctx.font = style.font;

            // Block-level decoration (bullets, blockquote bars, etc.)
            def.drawDecoration(ctx, PAGE_PADDING, y);

            const wrapped = wrapTextForLayout(ctx, block.text, contentWidth - style.indent);

            for (const wl of wrapped) {
                if (y > this._pageHeight - PAGE_PADDING) break;

                const lineHeight = style.size * LINE_HEIGHT;
                const lineX = PAGE_PADDING + style.indent;

                layoutLines.push({
                    blockIndex: bi,
                    startOffset: wl.startOffset,
                    text: wl.text,
                    x: lineX,
                    y,
                    height: lineHeight,
                    font: style.font,
                });

                ctx.fillStyle = style.color;
                if (wl.text) {
                    ctx.fillText(wl.text, lineX, y);
                }

                if (withCursor && bi === cursor.block && !cursorDrawn) {
                    const cursorInLine = cursor.offset - wl.startOffset;
                    if (cursorInLine >= 0 && cursorInLine <= wl.text.length) {
                        const cursorX = lineX + ctx.measureText(wl.text.slice(0, cursorInLine)).width;
                        if (this.editor.desiredX < 0) this.editor.desiredX = cursorX;
                        this.drawCursorLine(ctx, cursorX, y, lineHeight);
                        cursorDrawn = true;
                    }
                }

                y += lineHeight;
            }

            y += style.size * 0.4;
        }

        if (withCursor && !cursorDrawn && blocks.length > 0) {
            const style = BlockTypeRegistry.get(blocks[0].type).style;
            this.drawCursorLine(ctx, PAGE_PADDING + style.indent, PAGE_PADDING, style.size * LINE_HEIGHT);
        }

        ctx.restore();
        this.editor.setLayoutLines(layoutLines);
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
