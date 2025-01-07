import {ITool} from "./Tools.ts";
import {DrawableCanvas, Vector2} from "../DrawableCanvas.ts";

export class EraserTool implements ITool {
    private stroke: boolean = true;
    
    public constructor() {
    }
    
    public interrupt(canvas: DrawableCanvas): void {
    }

    public start(canvas: DrawableCanvas, event: PointerEvent): void {
    }

    public update(canvas: DrawableCanvas, event: PointerEvent, position: Vector2): void {
        canvas.getElements.filter((value) => {
            if (canvas.within(value.boundingBox, position)) {
                // canvas.getElements.
            }
        });
    }

    public finish(canvas: DrawableCanvas, event: PointerEvent): void {
    }

    get label(): string {
        return "";
    }
    
    get icon(): string {
        return "";
    }
}