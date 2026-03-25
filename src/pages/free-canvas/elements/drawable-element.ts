import {Vector2} from "../drawable-canvas";
import {ISerializable} from "../../../lib/utils/binary-helper";
import {BinaryReader, BinaryWriter} from "../../../lib/utils/binary-helper";
import {DrawableElementRegistry} from "./drawable-element-registry";
import ElementType = DrawableElementRegistry.ElementType;

const SELECTION_STROKE = '#2f3e46';
const HANDLE_SIZE = 6;
const SELECTION_PADDING = 4;
const SELECTION_RADIUS = 4;
const SELECTION_ANIM_SPEED = 8;

export abstract class DrawableElement implements ISerializable {
    private scale: Vector2 = { x: 1, y: 1 };
    private selected: boolean = false;
    private selectionT: number = 0;

	protected constructor(public readonly index: number, public readonly type: ElementType) {
	}

    public draw(ctx: CanvasRenderingContext2D, deltaTime: number): void {
        ctx.save();

        ctx.scale(this.scale.x, this.scale.y);
        this.draw2D(ctx, deltaTime);

        if (this.selected) {
            this.selectionT = Math.min(1, this.selectionT + deltaTime * SELECTION_ANIM_SPEED);
        }

        if (this.selectionT > 0) {
            this.drawSelection(ctx, this.selectionT);
        }

        ctx.restore();
    }

    private drawSelection(ctx: CanvasRenderingContext2D, t: number): void {
        const box = this.boundingBox;
        const eased = 1 - (1 - t) * (1 - t);

        const pad = SELECTION_PADDING * eased;
        const x = box.x - pad;
        const y = box.y - pad;
        const w = box.width + pad * 2;
        const h = box.height + pad * 2;
        const r = SELECTION_RADIUS * eased;

        ctx.globalAlpha = eased;

        // Selection fill
        ctx.fillStyle = `rgba(208, 225, 251, 0.12)`;
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, r);
        ctx.fill();

        // Selection border
        ctx.strokeStyle = SELECTION_STROKE;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, r);
        ctx.stroke();

        // Corner handles
        const handleScale = eased;
        const size = HANDLE_SIZE * handleScale;
        const half = size / 2;
        const corners: [number, number][] = [
            [x - half, y - half],
            [x + w - half, y - half],
            [x - half, y + h - half],
            [x + w - half, y + h - half],
        ];

        for (const [cx, cy] of corners) {
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.roundRect(cx, cy, size, size, 1.5 * handleScale);
            ctx.fill();

            ctx.strokeStyle = SELECTION_STROKE;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.roundRect(cx, cy, size, size, 1.5 * handleScale);
            ctx.stroke();
        }

        ctx.globalAlpha = 1;
    }

    public select() {
        this.selected = true;
    }

    public unselect() {
        this.selected = false;
        this.selectionT = 0;
    }

    public changeDimensionRelative(x: number, y: number) {
        const propX = x / this.boundingBox.width;
        const propY = y / this.boundingBox.height;

        this.scale.x = this.scale.x + propX;
        this.scale.y = this.scale.y + propY;

        this.updateBounds();
    }

    public updateBounds() {
        this.updateBoundingBox(this.scale);
    }

    public load(reader: BinaryReader): void {
        this.scale.x = reader.readF32();
        this.scale.y = reader.readF32();
    }

    public save(writer: BinaryWriter): void {
        writer.writeF32(this.scale.x);
        writer.writeF32(this.scale.y);
    }

    public get isSelected() {
        return this.selected;
    }

    public abstract get boundingBox(): DOMRect;
    public abstract isOver(x: number, y: number, radius: number, ctx: CanvasRenderingContext2D): boolean;
    protected abstract updateBoundingBox(scale: Vector2): void;
    protected abstract draw2D(ctx: CanvasRenderingContext2D, deltaTime: number): void;
}
