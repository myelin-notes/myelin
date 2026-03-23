import {DrawableCanvas, Vector2} from "../DrawableCanvas";
import type {LucideIcon} from "lucide-react";

export type SvgIcon = LucideIcon;

export interface ITool {
    start(canvas: DrawableCanvas, event: PointerEvent): void;
    update(canvas: DrawableCanvas, event: PointerEvent, position: Vector2): void;
    finish(canvas: DrawableCanvas, event: PointerEvent): void;
    interrupt(canvas: DrawableCanvas): void;
    drawCursor(ctx: CanvasRenderingContext2D, position: Vector2): void;
    get icon(): SvgIcon;
    get label(): string;
}
