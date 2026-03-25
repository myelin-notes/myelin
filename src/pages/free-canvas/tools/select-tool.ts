import {ITool, SvgIcon} from "./tool";
import {DrawableCanvas, Vector2} from "../drawable-canvas";
import {CollisionHelper} from "../../../lib/utils/collision-helper";
import { MousePointer2 as PointerIcon } from "lucide-react";

export class SelectTool implements ITool {

    private startPoint: Vector2 = {x: 0, y: 0};
    private finished: boolean = true;

    public drawCursor(ctx: CanvasRenderingContext2D, position: Vector2): void {
        if (this.finished) return;

        const x = Math.min(this.startPoint.x, position.x);
        const y = Math.min(this.startPoint.y, position.y);
        const w = Math.abs(position.x - this.startPoint.x);
        const h = Math.abs(position.y - this.startPoint.y);

        // Marquee fill
        ctx.fillStyle = 'rgba(208, 225, 251, 0.15)';
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, 3);
        ctx.fill();

        // Marquee border
        ctx.strokeStyle = '#2f3e46';
        ctx.lineWidth = 1;
        ctx.setLineDash([6, 4]);
        ctx.lineDashOffset = 0;
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, 3);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    public start(canvas: DrawableCanvas, event: PointerEvent): void {
        this.startPoint = canvas.getPoint(event);
        this.finished = false;

        for (const e of canvas.elements) {
            if (CollisionHelper.inBox(this.startPoint, e.boundingBox)) {
                e.select();
            } else {
                e.unselect();
            }
        }
    }

    public update(canvas: DrawableCanvas, _event: PointerEvent, position: Vector2): void {
        for (const e of canvas.elements) {
            if (CollisionHelper.overlappingAreaOf2Rect(
                new DOMRect(
                    Math.min(this.startPoint.x, position.x),
                    Math.min(this.startPoint.y, position.y),
                    Math.abs(position.x - this.startPoint.x),
                    Math.abs(position.y - this.startPoint.y)),
                e.boundingBox) > e.boundingBox.width * e.boundingBox.height * 0.5
            ) {
                e.select();
            }
        }
    }

    public finish(_canvas: DrawableCanvas, _event: PointerEvent): void {
        this.finished = true;
    }

    public interrupt(_canvas: DrawableCanvas): void {
        this.finished = true;
    }

    public get icon(): SvgIcon {
        return PointerIcon;
    }

    public get label(): string {
        return "Select";
    }
}
