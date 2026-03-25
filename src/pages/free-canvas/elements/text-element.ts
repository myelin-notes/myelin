import {DrawableElement} from "./drawable-element";
import {BinaryReader, BinaryWriter} from "../../../lib/utils/binary-helper";
import {ElementType} from "./element-type";

export interface TextStyle {
    color: string;
    fontSize: number;
    fontFamily: string;
}

const DEFAULT_STYLE: TextStyle = {
    color: "#1a1a1a",
    fontSize: 24,
    fontFamily: "sans-serif",
};

export class TextElement extends DrawableElement {
    private box: DOMRect = new DOMRect(0, 0, 0, 0);
    private _text: string = "";
    private _style: TextStyle;
    private _position: { x: number; y: number } = { x: 0, y: 0 };

    public constructor(index: number, text: string = "", style: Partial<TextStyle> = {}) {
        super(index, ElementType.TEXT);
        this._text = text;
        this._style = { ...DEFAULT_STYLE, ...style };
    }

    public get text(): string { return this._text; }
    public get style(): TextStyle { return this._style; }
    public get position(): { x: number; y: number } { return this._position; }

    public setText(text: string) {
        this._text = text;
        this.measureAndUpdate();
    }

    public setPosition(x: number, y: number) {
        this._position = { x, y };
        this.measureAndUpdate();
    }

    protected draw2D(ctx: CanvasRenderingContext2D, _deltaTime: number): void {
        if (!this._text) return;
        ctx.font = `${this._style.fontSize}px ${this._style.fontFamily}`;
        ctx.fillStyle = this._style.color;
        ctx.textBaseline = "top";

        const lines = this._text.split("\n");
        const lineHeight = this._style.fontSize * 1.3;
        for (let i = 0; i < lines.length; i++) {
            ctx.fillText(lines[i], this._position.x, this._position.y + i * lineHeight);
        }
    }

    protected isOverLocal(x: number, y: number, _radius: number, _ctx: CanvasRenderingContext2D): boolean {
        const b = this.box;
        return x >= b.x && x <= b.right && y >= b.y && y <= b.bottom;
    }

    public get localBoundingBox(): DOMRect {
        return this.box;
    }

    protected updateBoundingBox(): void {
        this.measureAndUpdate();
    }

    private measureAndUpdate() {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d")!;
        ctx.font = `${this._style.fontSize}px ${this._style.fontFamily}`;

        const lines = this._text.split("\n");
        const lineHeight = this._style.fontSize * 1.3;
        let maxWidth = 0;
        for (const line of lines) {
            maxWidth = Math.max(maxWidth, ctx.measureText(line).width);
        }

        const height = lines.length * lineHeight;
        this.box = new DOMRect(this._position.x, this._position.y, maxWidth, height);
    }

    public load(reader: BinaryReader): void {
        super.load(reader);
        this._text = reader.readString();
        this._style = {
            color: reader.readString(),
            fontSize: reader.readF32(),
            fontFamily: reader.readString(),
        };
        this._position = { x: reader.readF32(), y: reader.readF32() };
        this.measureAndUpdate();
    }

    public save(writer: BinaryWriter): void {
        super.save(writer);
        writer.writeString(this._text);
        writer.writeString(this._style.color);
        writer.writeF32(this._style.fontSize);
        writer.writeString(this._style.fontFamily);
        writer.writeF32(this._position.x);
        writer.writeF32(this._position.y);
    }
}
