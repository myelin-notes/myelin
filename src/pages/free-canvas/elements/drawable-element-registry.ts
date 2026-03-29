import type { DrawableElement } from './drawable-element';
import { ElementType } from './element-type';
import { ImageElement } from './image-element';
import { PageFrameElement } from './page-frame-element';
import { Stroke } from './stroke';
import { TextElement } from './text-element';

export namespace DrawableElementRegistry {
  export const MAP: Record<ElementType, (i: number) => DrawableElement> = {
    [ElementType.STROKE]: (i) =>
      new Stroke(i, [], false, {
        color: 'black',
        size: 12,
      }),
    [ElementType.TEXT]: (i) => new TextElement(i),
    [ElementType.IMAGE]: (i) => new ImageElement(i),
    [ElementType.PAGE_FRAME]: (i) => new PageFrameElement(i),
  };
}
