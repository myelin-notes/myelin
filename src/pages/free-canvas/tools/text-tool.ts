import {ITool, SvgIcon, ToolOption, FontEntry} from "./tool";
import {DrawableCanvas, EditTextCommand, Vector2} from "../drawable-canvas";
import {TextElement} from "../elements/text-element";
import {CollisionHelper} from "../../../lib/utils/collision-helper";
import { Type as TypeIcon } from "lucide-react";

const TEXT_COLORS = [
    '#191c1e',
    '#64748b',
    '#1c2738',
    '#3b82f6',
    '#ef4444',
    '#059669',
    '#f59e0b',
    '#8b5cf6',
];

const TEXT_FONTS: FontEntry[] = [
    { family: 'Inter', category: 'sans-serif' },
    { family: 'Roboto', category: 'sans-serif' },
    { family: 'Open Sans', category: 'sans-serif' },
    { family: 'Lato', category: 'sans-serif' },
    { family: 'Poppins', category: 'sans-serif' },
    { family: 'Newsreader', category: 'serif' },
    { family: 'Playfair Display', category: 'serif' },
    { family: 'Merriweather', category: 'serif' },
    { family: 'Lora', category: 'serif' },
    { family: 'JetBrains Mono', category: 'monospace' },
    { family: 'Fira Code', category: 'monospace' },
    { family: 'Caveat', category: 'cursive' },
    { family: 'Kalam', category: 'cursive' },
];

export class TextTool implements ITool {
    private color: string = '#191c1e';
    private fontSize: number = 24;
    private fontFamily: string = 'Inter';

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
        canvas.requestTextEdit(screenPos, screenFontSize, element.style.fontFamily, oldText, (text: string) => {
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
        const halfLine = this.fontSize * 1.3 / 2;
        const placedPos = { x: worldPos.x, y: worldPos.y - halfLine };
        const screenPos = canvas.worldToScreen(placedPos);
        const screenFontSize = this.fontSize * canvas.zoom;

        canvas.requestTextEdit(screenPos, screenFontSize, this.fontFamily, "", (text: string) => {
            if (!text.trim()) return;
            const el = canvas.addElement(i => {
                const te = new TextElement(i, text, {
                    color: this.color,
                    fontSize: this.fontSize,
                    fontFamily: this.fontFamily,
                });
                te.setPosition(placedPos.x, placedPos.y);
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

    getOptions(): ToolOption[] {
        return [
            { type: 'font', key: 'fontFamily', label: 'Font', value: this.fontFamily, fonts: TEXT_FONTS },
            { type: 'color', key: 'color', label: 'Color', value: this.color, palette: TEXT_COLORS },
            { type: 'size', key: 'fontSize', label: 'Font Size', value: this.fontSize, min: 12, max: 72, step: 2 },
        ];
    }

    setOption(key: string, value: unknown): void {
        if (key === 'color' && typeof value === 'string') this.color = value;
        if (key === 'fontSize' && typeof value === 'number') this.fontSize = value;
        if (key === 'fontFamily' && typeof value === 'string') this.fontFamily = value;
    }
}
