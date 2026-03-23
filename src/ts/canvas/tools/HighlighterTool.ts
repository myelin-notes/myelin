import {DrawableCanvas} from "../DrawableCanvas";
import {PenTool} from "./PenTool";
import {Stroke} from "../elements/Stroke";
import type {SvgIcon} from "./ITool";
import HighlighterIcon from "@/assets/icons/highlighter.svg?react";

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
