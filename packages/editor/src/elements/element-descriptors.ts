import { AudioElement } from './audio/element';
import { CodeOutputElement } from './code-output/element';
import type { DrawableElement } from './drawable-element';
import { ElementType } from './element-type';
import { ImageElement } from './image-element';
import { LatexElement } from './latex/element';
import { PageFrameElement } from './page-frame-element';
import { PdfElement } from './pdf';
import { ShapeElement } from './shape-element';
import { StrokeElement } from './stroke-element';
import { TextElement } from './text/element';

export type ElementFactory = (uuid: string) => DrawableElement;
export type ExternalSummaryPolicy =
  | 'supported'
  | 'grouped'
  | 'unknown-compatible';

export interface ElementDescriptor {
  type: ElementType;
  name: string;
  create: ElementFactory;
  externalSummary: ExternalSummaryPolicy;
  summaryUuidSample?: 'page-frame' | 'stroke';
}

export const ELEMENT_DESCRIPTORS = [
  {
    type: ElementType.STROKE,
    name: 'stroke',
    create: (uuid) =>
      new StrokeElement(uuid, [], false, { color: 'black', size: 12 }),
    externalSummary: 'grouped',
    summaryUuidSample: 'stroke',
  },
  {
    type: ElementType.TEXT,
    name: 'text',
    create: (uuid) => new TextElement(uuid),
    externalSummary: 'supported',
  },
  {
    type: ElementType.IMAGE,
    name: 'image',
    create: (uuid) => new ImageElement(uuid),
    externalSummary: 'supported',
  },
  {
    type: ElementType.PAGE_FRAME,
    name: 'page-frame',
    create: (uuid) => new PageFrameElement(uuid),
    externalSummary: 'supported',
    summaryUuidSample: 'page-frame',
  },
  {
    type: ElementType.PDF,
    name: 'pdf',
    create: (uuid) => new PdfElement(uuid),
    externalSummary: 'supported',
  },
  {
    type: ElementType.SHAPE,
    name: 'shape',
    create: (uuid) =>
      new ShapeElement(uuid, 'rect', [0, 0, 0, 0], {
        color: '#191c1e',
        size: 8,
      }),
    externalSummary: 'unknown-compatible',
  },
  {
    type: ElementType.LATEX,
    name: 'latex',
    create: (uuid) => new LatexElement(uuid),
    externalSummary: 'supported',
  },
  {
    type: ElementType.AUDIO,
    name: 'audio',
    create: (uuid) => new AudioElement(uuid),
    externalSummary: 'unknown-compatible',
  },
  {
    type: ElementType.CODE_OUTPUT,
    name: 'code-output',
    create: (uuid) => new CodeOutputElement(uuid),
    externalSummary: 'unknown-compatible',
  },
] as const satisfies readonly ElementDescriptor[];

export type SupportedExternalSummaryElementName = Extract<
  (typeof ELEMENT_DESCRIPTORS)[number],
  { externalSummary: 'supported' }
>['name'];

export type RegisteredElementDescriptor = ElementDescriptor &
  (typeof ELEMENT_DESCRIPTORS)[number];

const descriptorsByType: ReadonlyMap<number, RegisteredElementDescriptor> =
  new Map(
    ELEMENT_DESCRIPTORS.map((descriptor) => [descriptor.type, descriptor]),
  );

export function getElementDescriptor(
  type: number | null | undefined,
): RegisteredElementDescriptor | undefined {
  return typeof type === 'number' ? descriptorsByType.get(type) : undefined;
}

export const ELEMENT_FACTORIES: Record<ElementType, ElementFactory> =
  Object.fromEntries(
    ELEMENT_DESCRIPTORS.map((descriptor) => [
      descriptor.type,
      descriptor.create,
    ]),
  ) as unknown as Record<ElementType, ElementFactory>;
