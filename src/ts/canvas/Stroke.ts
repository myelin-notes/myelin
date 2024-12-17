import {IDrawableElement} from "./DrawableCanvas.ts";
import {getStroke, getStrokeOutlinePoints, getStrokePoints} from "perfect-freehand";

export class Stroke implements IDrawableElement {
    private box: DOMRect;

    public constructor(private points: [number, number, number][], private hasPressure: boolean) {
        this.buildBoundingBox();
        this.box = new DOMRect(0, 0, 0, 0);
    }

    public draw(ctx: CanvasRenderingContext2D): void {
        if (this.points.length == 0) return;

        const baked = getStroke(this.points, {
            simulatePressure: !this.hasPressure,
        });

        const path = new Path2D(this.getSvgPathFromStroke(baked));

        ctx.fillStyle = "black";
        ctx.fill(path);
    }

    public boundingBox(): DOMRect {
        return this.box;
    }

    public addPoint(x: number, y: number, pressure: number | undefined) {
        this.points = [...this.points, [x, y, pressure ?? 0]];
    }

    public buildBoundingBox() {
        const outlinePoints = getStrokeOutlinePoints(getStrokePoints(this.points));

        let minX = Number.MAX_VALUE;
        let minY = Number.MAX_VALUE;
        let maxX = Number.MIN_VALUE;
        let maxY = Number.MIN_VALUE;

        for (const [x, y, _pressure] of outlinePoints) {
            if (x < minX) {
                minX = x;
            }

            if (x > maxX) {
                maxX = x;
            }

            if (y < minY) {
                minY = y;
            }
            
            if (y > maxY) {
                maxY = y;
            }
        }
        
        this.box = new DOMRect(minX, minY, maxX - minX, maxY - minY);
    }

    private average(a: number, b: number) {
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
}
