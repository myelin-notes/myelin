import {ITool, SvgIcon, ToolOption} from "./tool";
import {DrawableCanvas, Vector2} from "../drawable-canvas";
import {Stroke} from "../elements/stroke";
import { PenTool as PenIcon } from "lucide-react";

const PEN_COLORS = [
    '#191c1e',
    '#64748b',
    '#1c2738',
    '#3b82f6',
    '#ef4444',
    '#059669',
    '#f59e0b',
    '#8b5cf6',
];

export class PenTool implements ITool {
    protected currentStroke: Stroke | null = null;
    protected color: string = '#191c1e';
    protected size: number = 8;

    public constructor() {
    }

    public start(canvas: DrawableCanvas, _event: PointerEvent): void {
        this.currentStroke = canvas.addElement(i => new Stroke(i, [], false, { color: this.color, size: this.size }));
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

    getOptions(): ToolOption[] {
        return [
            { type: 'color', key: 'color', label: 'Color', value: this.color, palette: PEN_COLORS },
            { type: 'size', key: 'size', label: 'Stroke', value: this.size, min: 1, max: 40, step: 1 },
        ];
    }

    setOption(key: string, value: unknown): void {
        if (key === 'color' && typeof value === 'string') this.color = value;
        if (key === 'size' && typeof value === 'number') this.size = value;
    }
}
