import { ITool, SvgIcon } from "./tool";
import { DrawableCanvas, Vector2 } from "../drawable-canvas";
import { ChartSpline as ChartSplineIcon } from "lucide-react";
import { GraphElement } from "../elements/graph-element";

export class GraphTool implements ITool {

    start(_canvas: DrawableCanvas, _event: PointerEvent): void {}

    update(_canvas: DrawableCanvas, _event: PointerEvent, _position: Vector2): void {}

    finish(canvas: DrawableCanvas, event: PointerEvent): void {
        const world = canvas.getPoint(event);
        const graph = canvas.addElement(i => new GraphElement(i));
        graph.setPosition(world.x - 200, world.y - 150);
        graph.updateBounds();
        graph.init();
    }

    interrupt(_canvas: DrawableCanvas): void {}

    drawCursor(_ctx: CanvasRenderingContext2D, _position: Vector2): void {}

    get icon(): SvgIcon {
        return ChartSplineIcon;
    }

    get label(): string {
        return "Graph";
    }
}
