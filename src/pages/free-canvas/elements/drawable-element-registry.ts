import {Stroke} from "./stroke";
import {DrawableElement} from "./drawable-element";

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
