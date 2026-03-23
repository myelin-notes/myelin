import {Vector2} from "../DrawableCanvas";
import {ISerializable} from "../../utils/ISerializable";
import {BinaryReader, BinaryWriter} from "../../utils/BinaryHelper";
import {DrawableElementRegistry} from "./DrawableElementRegistry";
import ElementType = DrawableElementRegistry.ElementType;

export const PRIMARY_COLOR = '#DECDF5';

export abstract class DrawableElement implements ISerializable {
    private scale: Vector2 = { x: 1, y: 1 };
    private selected: boolean = false;

	protected constructor(public readonly index: number, public readonly type: ElementType) {
	}

    public draw(ctx: CanvasRenderingContext2D, deltaTime: number): void {
        ctx.save();

        ctx.scale(this.scale.x, this.scale.y);
        this.draw2D(ctx, deltaTime);

        if (this.selected) {
            const box = this.boundingBox;
            ctx.lineWidth = 3;
            ctx.strokeStyle = PRIMARY_COLOR;
            ctx.strokeRect(box.x, box.y, box.width, box.height);
        }

        ctx.restore();
    }

    public select() {
        this.selected = true;
    }

    public unselect() {
        this.selected = false;
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
