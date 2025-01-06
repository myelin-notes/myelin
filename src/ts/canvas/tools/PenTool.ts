import {ITool} from "./Tools.ts";
import {DrawableCanvas, Vector2} from "../DrawableCanvas.ts";
import {Stroke} from "../Stroke.ts";

export class PenTool implements ITool {
    private currentStroke: Stroke | null = null;
    
    public constructor() {
    }
    
    public start(canvas: DrawableCanvas, _event: PointerEvent): void {
        const stroke = new Stroke([], false);
        canvas.addElement(stroke);
        this.currentStroke = stroke;
    }

    public update(_canvas: DrawableCanvas, event: PointerEvent, position: Vector2): void {
        this.currentStroke?.addPoint(position.x, position.y, event.pressure);
    }

    public finish(canvas: DrawableCanvas, _event: PointerEvent): void {
        this.interrupt(canvas);
    }
    
    public interrupt(canvas: DrawableCanvas): void {
        this.currentStroke?.updateBounds();
        this.currentStroke = null
        canvas.updateBounding();
    }

    get icon(): string {
        return "pi pi-pencil";
    }

    get label(): string {
        return "Pen";
    }
}