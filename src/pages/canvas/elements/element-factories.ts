import type { DrawableElement } from './drawable-element';
import { ElementType } from './element-type';
import { ImageElement } from './image-element';
import { PageFrameElement } from './page-frame-element';
import { PdfElement } from './pdf-element';
import { ShapeElement } from './shape-element';
import { StrokeElement } from './stroke-element';
import { TextElement } from './text/element';

export type ElementFactory = (uuid: string) => DrawableElement;

export const ELEMENT_FACTORIES: Record<ElementType, ElementFactory> = {
  [ElementType.STROKE]: (uuid) =>
    new StrokeElement(uuid, [], false, {
      color: 'black',
      size: 12,
    }),
  [ElementType.TEXT]: (uuid) => new TextElement(uuid),
  [ElementType.IMAGE]: (uuid) => new ImageElement(uuid),
  [ElementType.PAGE_FRAME]: (uuid) => new PageFrameElement(uuid),
  [ElementType.PDF]: (uuid) => new PdfElement(uuid),
  [ElementType.SHAPE]: (uuid) =>
    new ShapeElement(uuid, 'rect', [0, 0, 0, 0], {
      color: '#191c1e',
      size: 8,
    }),
};
