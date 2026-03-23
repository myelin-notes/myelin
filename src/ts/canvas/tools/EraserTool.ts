import {ITool, SvgIcon} from "./ITool";
import {DrawableCanvas, Vector2} from "../DrawableCanvas";
import EraserIcon from "@/assets/icons/eraser.svg?react";

export class EraserTool implements ITool {
    private radius: number;

    public constructor() {
        this.radius = 20;
    }

    public start(_canvas: DrawableCanvas, _event: PointerEvent): void {
    }

    public finish(_canvas: DrawableCanvas, _event: PointerEvent): void {
    }

    public interrupt(_canvas: DrawableCanvas): void {
    }

    public update(canvas: DrawableCanvas, _event: PointerEvent, position: Vector2): void {
        canvas.getElements
            .actives
            .filter(e => e.isOver(position.x, position.y, this.radius, canvas.ctx))
            .forEach(e => canvas.getElements.remove(e.index));
    }

    public drawCursor(ctx: CanvasRenderingContext2D, position: Vector2): void {
        ctx.strokeStyle = "black";
        ctx.beginPath();
        ctx.arc(position.x, position.y, this.radius, 0, 2 * Math.PI);
        ctx.stroke();
    }

    get icon(): SvgIcon {
        return EraserIcon;
    }

    get label(): string {
        return "Eraser";
    }
}
