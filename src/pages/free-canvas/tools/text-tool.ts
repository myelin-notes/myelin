import {ITool, SvgIcon} from "./tool";
import {DrawableCanvas, Vector2} from "../drawable-canvas";
import {TextElement} from "../elements/text-element";
import { Type as TypeIcon } from "lucide-react";

export class TextTool implements ITool {

    start(_canvas: DrawableCanvas, _event: PointerEvent): void {
    }

    update(_canvas: DrawableCanvas, _event: PointerEvent, _position: Vector2): void {
    }

    finish(canvas: DrawableCanvas, event: PointerEvent): void {
        const worldPos = canvas.getPoint(event);
        const screenPos = { x: event.pageX, y: event.pageY };
        canvas.requestTextEdit(screenPos, worldPos, (text: string) => {
            if (!text.trim()) return;
            const el = canvas.addElement(i => {
                const te = new TextElement(i, text);
                te.setPosition(worldPos.x, worldPos.y);
                return te;
            });
            el.updateBounds();
            canvas.updateBounding();
        });
    }

    interrupt(_canvas: DrawableCanvas): void {}

    drawCursor(_ctx: CanvasRenderingContext2D, _position: Vector2): void {}

    get icon(): SvgIcon {
        return TypeIcon;
    }

    get label(): string {
        return "Text";
    }
}
