import {getStroke, getStrokeOutlinePoints, getStrokePoints} from "perfect-freehand";
import {DrawableElement} from "./drawable-element";
import {Vector2} from "../drawable-canvas";
import {BinaryReader, BinaryWriter} from "../../../lib/utils/binary-helper";
import {DrawableElementRegistry} from "./drawable-element-registry";
import ElementType = DrawableElementRegistry.ElementType;
import {CollisionHelper} from "../../../lib/utils/collision-helper";

export interface StrokeStyle {
    color: string,
    size: number,
}

export class Stroke extends DrawableElement {

    protected box: DOMRect;
    protected dirty: boolean = true;
    protected cachedPath: Path2D;
    protected cachedPoints: number[][];

    public constructor(index: number, protected points: [number, number, number][], protected hasPressure: boolean, protected style: StrokeStyle) {
        super(index, ElementType.STROKE);
        this.box = new DOMRect(0, 0, 0, 0);
        this.cachedPath = new Path2D();
        this.cachedPoints = [];
    }

    public addPoint(x: number, y: number, pressure: number | undefined) {
        this.points = [...this.points, [x, y, pressure ?? 0]];
        this.dirty = true;
    }

    public draw2D(ctx: CanvasRenderingContext2D, _deltaTime: number): void {
        if (this.points.length == 0) return;
        if (this.dirty) {
            this.cachedPoints = getStroke(this.points, {
                simulatePressure: !this.hasPressure,
                size: this.style.size,
            });
            this.cachedPath = new Path2D(this.getSvgPathFromStroke(this.cachedPoints));
        }

        ctx.fillStyle = this.style.color;
        ctx.fill(this.cachedPath);
    }

    public isOver(x: number, y: number, radius: number, _ctx: CanvasRenderingContext2D): boolean {
        return CollisionHelper.isPathOverlappingCircle(this.cachedPoints, {x, y}, radius);
    }

    public get boundingBox(): DOMRect {
        return this.box;
    }

    protected updateBoundingBox(scale: Vector2) {
        if (this.points.length === 0) return;

        const outlinePoints = getStrokeOutlinePoints(getStrokePoints(this.points));

        let minX = Number.POSITIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;

        for (const [x, y] of outlinePoints) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }

        minX /= scale.x;
        minY /= scale.y;
        maxX /= scale.x;
        maxY /= scale.y;

        this.box = new DOMRect(minX, minY, maxX - minX, maxY - minY);
    }

    protected average(a: number, b: number) {
        return (a + b) / 2;
    }

    private getSvgPathFromStroke(points: number[][], closed = true) {
        const len = points.length

        if (len < 4) {
            return ``
        }

        let a = points[0]
        let b = points[1]
        const c = points[2]

        let result = `M${a[0].toFixed(2)},${a[1].toFixed(2)} Q${b[0].toFixed(
            2
        )},${b[1].toFixed(2)} ${this.average(b[0], c[0]).toFixed(2)},${this.average(
            b[1],
            c[1]
        ).toFixed(2)} T`

        for (let i = 2, max = len - 1; i < max; i++) {
            a = points[i]
            b = points[i + 1]
            result += `${this.average(a[0], b[0]).toFixed(2)},${this.average(a[1], b[1]).toFixed(
                2
            )} `
        }

        if (closed) {
            result += 'Z'
        }

        return result
    }

    public load(reader: BinaryReader) {
        super.load(reader);

        const c = reader.readString();
        const s = reader.readF32();
        this.style = {
            color: c,
            size: s
        };

        this.hasPressure = reader.readBool();
        const len = reader.readU32();
        this.points = new Array(len);

        for (let i = 0; i < len; i++) {
            this.points[i] = [
                reader.readF32(),
                reader.readF32(),
                this.hasPressure ? reader.readF32() : 0
            ];
        }

        this.dirty = true;
        this.updateBounds();
    }

    public save(writer: BinaryWriter) {
        super.save(writer);

        writer.writeString(this.style.color);
        writer.writeF32(this.style.size);

        writer.writeBool(this.hasPressure);
        writer.writeU32(this.points.length);

        for (const [x, y, pressure] of this.points) {
            writer.writeF32(x);
            writer.writeF32(y);

            if (this.hasPressure) {
                writer.writeF32(pressure);
            }
        }
    }
}
