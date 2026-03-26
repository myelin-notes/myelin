import {DrawableElement} from "./drawable-element";
import {BinaryReader, BinaryWriter} from "../../../lib/utils/binary-helper";
import {ElementType} from "./element-type";

export class ImageElement extends DrawableElement {
    private box: DOMRect = new DOMRect(0, 0, 0, 0);
    private _position: { x: number; y: number } = { x: 0, y: 0 };
    private _imageData: ArrayBuffer = new ArrayBuffer(0);
    private _bitmap: ImageBitmap | null = null;
    private _naturalWidth: number = 0;
    private _naturalHeight: number = 0;

    public constructor(index: number) {
        super(index, ElementType.IMAGE);
    }

    public get position(): { x: number; y: number } { return this._position; }
    public get naturalWidth(): number { return this._naturalWidth; }
    public get naturalHeight(): number { return this._naturalHeight; }

    public setPosition(x: number, y: number) {
        this._position = { x, y };
        this.updateBox();
    }

    public async setImageData(data: ArrayBuffer) {
        this._imageData = data;
        const blob = new Blob([data]);
        this._bitmap = await createImageBitmap(blob);
        this._naturalWidth = this._bitmap.width;
        this._naturalHeight = this._bitmap.height;
        this.updateBox();
    }

    private updateBox() {
        this.box = new DOMRect(
            this._position.x,
            this._position.y,
            this._naturalWidth,
            this._naturalHeight,
        );
    }

    protected draw2D(ctx: CanvasRenderingContext2D, _deltaTime: number): void {
        if (!this._bitmap) return;
        ctx.drawImage(this._bitmap, this._position.x, this._position.y);
    }

    protected isOverLocal(x: number, y: number, _radius: number, _ctx: CanvasRenderingContext2D): boolean {
        const b = this.box;
        return x >= b.x && x <= b.right && y >= b.y && y <= b.bottom;
    }

    public get localBoundingBox(): DOMRect {
        return this.box;
    }

    protected updateBoundingBox(): void {
        this.updateBox();
    }

    public load(reader: BinaryReader): void {
        super.load(reader);
        this._position = { x: reader.readF32(), y: reader.readF32() };
        this._naturalWidth = reader.readF32();
        this._naturalHeight = reader.readF32();
        this._imageData = reader.readBuffer();
        this.updateBox();

        // Rebuild bitmap asynchronously
        const blob = new Blob([this._imageData]);
        createImageBitmap(blob).then(bmp => {
            this._bitmap = bmp;
        });
    }

    public save(writer: BinaryWriter): void {
        super.save(writer);
        writer.writeF32(this._position.x);
        writer.writeF32(this._position.y);
        writer.writeF32(this._naturalWidth);
        writer.writeF32(this._naturalHeight);
        writer.writeBuffer(this._imageData);
    }
}
