import {DrawableCanvas} from "../drawable-canvas";
import {PenTool} from "./pen-tool";
import {Stroke} from "../elements/stroke";
import type {SvgIcon} from "./tool";
import { Highlighter as HighlighterIcon } from "lucide-react";

export class HighlighterTool extends PenTool {
    public start(canvas: DrawableCanvas, _event: PointerEvent): void {
        this.currentStroke = canvas.addElement(i => new Stroke(i, [], false, {
            color: 'rgba(0,0,0,0.2)',
            size: 36
        }));
    }

    get icon(): SvgIcon {
        return HighlighterIcon;
    }

    get label(): string {
        return "Highlighter";
    }
}
