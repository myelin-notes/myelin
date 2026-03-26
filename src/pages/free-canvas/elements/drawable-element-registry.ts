import {Stroke} from "./stroke";
import {TextElement} from "./text-element";
import {ImageElement} from "./image-element";
import {DrawableElement} from "./drawable-element";
import {ElementType} from "./element-type";

export namespace DrawableElementRegistry {
    export const MAP: Record<ElementType, (i: number) => DrawableElement> = {
        [ElementType.STROKE]: i => new Stroke(i, [], false, {
            color: "black",
            size: 12,
        }),
        [ElementType.TEXT]: i => new TextElement(i),
        [ElementType.IMAGE]: i => new ImageElement(i),
    };
}
