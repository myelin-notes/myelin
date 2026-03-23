import {ITool, SvgIcon} from "./tool";
import {DrawableCanvas, Vector2} from "../drawable-canvas";
import {CollisionHelper} from "../../../lib/utils/collision-helper";
import { MousePointer2 as PointerIcon } from "lucide-react";

export class SelectTool implements ITool {

    private startPoint: Vector2 = {x: 0, y: 0};
    private finished: boolean = true;

    public drawCursor(ctx: CanvasRenderingContext2D, position: Vector2): void {
        if (this.finished) return;
        ctx.setLineDash([15]);
        ctx.lineWidth = 1.25;
        ctx.strokeStyle = 'black';
        ctx.strokeRect(this.startPoint.x, this.startPoint.y, position.x - this.startPoint.x, position.y - this.startPoint.y);
    }

    public start(canvas: DrawableCanvas, event: PointerEvent): void {
        this.startPoint = canvas.getPoint(event);
        this.finished = false;

        for (const e of canvas.getElements.actives) {
            if (CollisionHelper.inBox(this.startPoint, e.boundingBox)) {
                e.select();
            } else {
                e.unselect();
            }
        }
    }

    public update(canvas: DrawableCanvas, _event: PointerEvent, position: Vector2): void {
        for (const e of canvas.getElements.actives) {
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
