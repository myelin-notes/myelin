import { DrawableElement } from "./drawable-element";
import { BinaryReader, BinaryWriter } from "../../../lib/utils/binary-helper";
import { ElementType } from "./element-type";
import { createGraphInstance, type GraphInstance } from "../../../lib/graph";

const DEFAULT_WIDTH = 400;
const DEFAULT_HEIGHT = 300;
const BORDER_RADIUS = 8;
const BORDER_COLOR = '#e2e8f0';

export class GraphElement extends DrawableElement {
    private box: DOMRect = new DOMRect(0, 0, DEFAULT_WIDTH, DEFAULT_HEIGHT);
    private _position = { x: 0, y: 0 };
    private _width = DEFAULT_WIDTH;
    private _height = DEFAULT_HEIGHT;
    private _expressions: string[] = ['gamma(x)'];
    private _bounds: [number, number, number, number] = [-10, -7.5, 10, 7.5];
    private _graph: GraphInstance | null = null;
    private _bitmap: ImageBitmap | null = null;

    public constructor(index: number) {
        super(index, ElementType.GRAPH);
    }

    public get position() { return this._position; }
    public get expressions() { return this._expressions; }

    public setPosition(x: number, y: number) {
        this._position = { x, y };
        this.updateBox();
    }

    public setExpressions(exprs: string[]) {
        this._expressions = exprs;
        this._graph?.setExpressions(exprs);
        this.rerenderBitmap();
    }

    public async init() {
        this._graph = createGraphInstance({
            width: this._width,
            height: this._height,
            expressions: this._expressions,
            xMin: this._bounds[0],
            yMin: this._bounds[1],
            xMax: this._bounds[2],
            yMax: this._bounds[3],
        });
        await this.rerenderBitmap();
    }

    private async rerenderBitmap() {
        if (!this._graph) return;
        try {
            this._bitmap?.close();
            this._bitmap = await this._graph.render();
        } catch {
            // render failed, bitmap stays null
        }
    }

    private updateBox() {
        this.box = new DOMRect(this._position.x, this._position.y, this._width, this._height);
    }

    protected draw2D(ctx: CanvasRenderingContext2D, _deltaTime: number): void {
        const { x, y } = this._position;

        // Rounded clip + white background
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(x, y, this._width, this._height, BORDER_RADIUS);
        ctx.clip();

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x, y, this._width, this._height);

        if (this._bitmap) {
            ctx.drawImage(this._bitmap, x, y, this._width, this._height);
        }
        ctx.restore();

        // Border
        ctx.strokeStyle = BORDER_COLOR;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(x, y, this._width, this._height, BORDER_RADIUS);
        ctx.stroke();
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
        this._width = reader.readF32();
        this._height = reader.readF32();
        this._bounds = [reader.readF32(), reader.readF32(), reader.readF32(), reader.readF32()];
        const exprCount = reader.readU32();
        this._expressions = [];
        for (let i = 0; i < exprCount; i++) {
            this._expressions.push(reader.readString());
        }
        this.updateBox();
        this.init();
    }

    public save(writer: BinaryWriter): void {
        super.save(writer);
        writer.writeF32(this._position.x);
        writer.writeF32(this._position.y);
        writer.writeF32(this._width);
        writer.writeF32(this._height);
        writer.writeF32(this._bounds[0]);
        writer.writeF32(this._bounds[1]);
        writer.writeF32(this._bounds[2]);
        writer.writeF32(this._bounds[3]);
        writer.writeU32(this._expressions.length);
        for (const expr of this._expressions) {
            writer.writeString(expr);
        }
    }
}
