import { DrawableElement } from "./drawable-element";
import { ElementType } from "./element-type";
import { BinaryReader, BinaryWriter } from "../../../lib/utils/binary-helper";
import { BlockEditor } from "./block-editor";
import { BlockTypeRegistry } from "./block-types";

export type { EditableBlock } from "./block-editor";

export const PAGE_WIDTH = 680;
export const PAGE_HEIGHT = 880;
export const PAGE_PADDING = 48;
export const PAGE_CORNER_RADIUS = 3;

export class PageFrameElement extends DrawableElement {
    private _pageWidth = PAGE_WIDTH;
    private _pageHeight = PAGE_HEIGHT;
    private _editing = false;

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
    }

    public exitEditMode(): void {
        this._editing = false;
        this.editor.trimTrailingEmpty();
    }

    // ── Drawing ──────────────────────────────────────────────────
    // Page chrome + text are rendered by the DOM layer.
    // Nothing to draw on canvas.

    protected draw2D(_ctx: CanvasRenderingContext2D, _deltaTime: number): void {}

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
