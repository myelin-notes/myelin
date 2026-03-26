import {ITool, SvgIcon} from "./tool";
import {DrawableCanvas, Vector2} from "../drawable-canvas";
import { ImagePlus as ImagePlusIcon } from "lucide-react";

export class EmbedTool implements ITool {

    start(_canvas: DrawableCanvas, _event: PointerEvent): void {
    }

    update(_canvas: DrawableCanvas, _event: PointerEvent, _position: Vector2): void {
    }

    finish(canvas: DrawableCanvas, event: PointerEvent): void {
        const screenPos = { x: event.pageX, y: event.pageY };
        canvas.requestFilePick(screenPos);
    }

    interrupt(_canvas: DrawableCanvas): void {}

    drawCursor(_ctx: CanvasRenderingContext2D, _position: Vector2): void {}

    get icon(): SvgIcon {
        return ImagePlusIcon;
    }

    get label(): string {
        return "Embed";
    }
}
