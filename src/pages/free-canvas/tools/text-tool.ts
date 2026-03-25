import {ITool, SvgIcon} from "./tool";
import {DrawableCanvas, EditTextCommand, Vector2} from "../drawable-canvas";
import {TextElement} from "../elements/text-element";
import {CollisionHelper} from "../../../lib/utils/collision-helper";
import { Type as TypeIcon } from "lucide-react";

const DEFAULT_FONT_SIZE = 24;

export class TextTool implements ITool {

    start(_canvas: DrawableCanvas, _event: PointerEvent): void {
    }

    update(_canvas: DrawableCanvas, _event: PointerEvent, _position: Vector2): void {
    }

    finish(canvas: DrawableCanvas, event: PointerEvent): void {
        const worldPos = canvas.getPoint(event);

        for (let i = canvas.elements.length - 1; i >= 0; i--) {
            const e = canvas.elements[i];
            if (e instanceof TextElement && CollisionHelper.inBox(worldPos, e.boundingBox)) {
                this.editExisting(canvas, e);
                return;
            }
        }

        this.createNew(canvas, worldPos);
    }

    private editExisting(canvas: DrawableCanvas, element: TextElement) {
        const worldOrigin = { x: element.boundingBox.x, y: element.boundingBox.y };
        const screenPos = canvas.worldToScreen(worldOrigin);
        const screenFontSize = element.style.fontSize * element.scale.y * canvas.zoom;
        const oldText = element.text;

        element.hidden = true;
        canvas.requestTextEdit(screenPos, screenFontSize, oldText, (text: string) => {
            element.hidden = false;
            if (!text.trim()) {
                canvas.removeElement(element);
            } else if (text !== oldText) {
                element.setText(text);
                element.updateBounds();
                canvas.pushApplied(new EditTextCommand(element, oldText, text));
            }
            canvas.updateBounding();
        });
    }

    private createNew(canvas: DrawableCanvas, worldPos: Vector2) {
        const screenPos = canvas.worldToScreen(worldPos);
        const screenFontSize = DEFAULT_FONT_SIZE * canvas.zoom;

        canvas.requestTextEdit(screenPos, screenFontSize, "", (text: string) => {
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
