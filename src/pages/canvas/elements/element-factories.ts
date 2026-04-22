import type { DrawableElement } from './drawable-element';
import { ElementType } from './element-type';
import { ImageElement } from './image-element';
import { PageFrameElement } from './page-frame-element';
import { PdfElement } from './pdf-element';
import { StrokeElement } from './stroke-element';
import { TextElement } from './text-element';

export type ElementFactory = (index: number) => DrawableElement;

export const ELEMENT_FACTORIES: Record<ElementType, ElementFactory> = {
  [ElementType.STROKE]: (index) =>
    new StrokeElement(index, [], false, {
      color: 'black',
      size: 12,
    }),
  [ElementType.TEXT]: (index) => new TextElement(index),
  [ElementType.IMAGE]: (index) => new ImageElement(index),
  [ElementType.PAGE_FRAME]: (index) => new PageFrameElement(index),
  [ElementType.PDF]: (index) => new PdfElement(index),
};
