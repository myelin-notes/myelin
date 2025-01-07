import {DrawableCanvas, Vector2} from "../DrawableCanvas.ts";

export interface ITool {
    start(canvas: DrawableCanvas, event: PointerEvent): void;
    update(canvas: DrawableCanvas, event: PointerEvent, position: Vector2): void;
    finish(canvas: DrawableCanvas, event: PointerEvent): void;
    interrupt(canvas: DrawableCanvas): void;
    get icon(): string;
    get label(): string;
}