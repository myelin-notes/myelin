import {Stroke} from "./Stroke";
import {DrawableElement} from "./DrawableElement";

export namespace DrawableElementRegistry {
    export const enum ElementType {
        STROKE = 0,
    }

    export const MAP: Record<ElementType, (i: number) => DrawableElement> = {
        [ElementType.STROKE]: i => new Stroke(i, [], false, {
            color: "black",
            size: 12,
        }),
    };
}
