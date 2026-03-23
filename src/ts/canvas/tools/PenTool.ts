import {ITool, SvgIcon} from "./ITool";
import {DrawableCanvas, Vector2} from "../DrawableCanvas";
import {Stroke} from "../elements/Stroke";
import { PenTool as PenIcon } from "lucide-react";

export class PenTool implements ITool {
    protected currentStroke: Stroke | null = null;

    public constructor() {
    }

    public start(canvas: DrawableCanvas, _event: PointerEvent): void {
        this.currentStroke = canvas.addElement(i => new Stroke(i, [], false, { color: 'black', size: 8 }));
    }

    public update(_canvas: DrawableCanvas, event: PointerEvent, position: Vector2): void {
        this.currentStroke?.addPoint(position.x, position.y, event.pressure);
    }

    public finish(canvas: DrawableCanvas, _event: PointerEvent): void {
        this.interrupt(canvas);
    }

    public interrupt(canvas: DrawableCanvas): void {
        this.currentStroke?.updateBounds();
        this.currentStroke = null;
        canvas.updateBounding();
    }

    public drawCursor(_ctx: CanvasRenderingContext2D, _position: Vector2): void {
    }

    get icon(): SvgIcon {
        return PenIcon;
    }

    get label(): string {
        return "Pen";
    }
}
