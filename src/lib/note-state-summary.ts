import * as Y from 'yjs';
import type { DrawableElement } from '@/pages/canvas/elements/drawable-element';
import { ElementType } from '@/pages/canvas/elements/element-type';
import type { YDocManager } from '@/pages/canvas/ydoc-manager';

const MAX_SAMPLED_ELEMENTS = 20;
const MAX_INDEX_SAMPLES = 50;

interface ElementDescriptor {
  position: number;
  index: number | null;
  type: string;
}

interface ElementCounts {
  strokeCount: number;
  textCount: number;
  imageCount: number;
  pageFrameCount: number;
  pdfCount: number;
  unknownCount: number;
}

function createEmptyCounts(): ElementCounts {
  return {
    strokeCount: 0,
    textCount: 0,
    imageCount: 0,
    pageFrameCount: 0,
    pdfCount: 0,
    unknownCount: 0,
  };
}

function appendIndexSample(samples: number[], index: number | null): void {
  if (typeof index !== 'number' || samples.length >= MAX_INDEX_SAMPLES) {
    return;
  }

  samples.push(index);
}

function summarizeElements(
  elementCount: number,
  readElement: (position: number) => { index: number | null; type: number | null },
) {
  const counts = createEmptyCounts();
  const sampledElements: ElementDescriptor[] = [];
  const pageFrameIndices: number[] = [];
  const strokeIndices: number[] = [];

  for (let position = 0; position < elementCount; position++) {
    const descriptor = readElement(position);
    const type = descriptor.type;
    const typeLabel = describeElementType(type);

    switch (type) {
      case ElementType.STROKE:
        counts.strokeCount += 1;
        appendIndexSample(strokeIndices, descriptor.index);
        break;
      case ElementType.TEXT:
        counts.textCount += 1;
        break;
      case ElementType.IMAGE:
        counts.imageCount += 1;
        break;
      case ElementType.PAGE_FRAME:
        counts.pageFrameCount += 1;
        appendIndexSample(pageFrameIndices, descriptor.index);
        break;
      case ElementType.PDF:
        counts.pdfCount += 1;
        break;
      default:
        counts.unknownCount += 1;
        break;
    }

    if (sampledElements.length < MAX_SAMPLED_ELEMENTS) {
      sampledElements.push({
        position,
        index: descriptor.index,
        type: typeLabel,
      });
    }
  }

  return {
    elementCount,
    ...counts,
    pageFrameIndices,
    strokeIndices,
    sampledElements,
    sampledElementOverflow: Math.max(0, elementCount - sampledElements.length),
  };
}

export function describeElementType(type: number | null | undefined): string {
  switch (type) {
    case ElementType.STROKE:
      return 'stroke';
    case ElementType.TEXT:
      return 'text';
    case ElementType.IMAGE:
      return 'image';
    case ElementType.PAGE_FRAME:
      return 'page-frame';
    case ElementType.PDF:
      return 'pdf';
    default:
      return `unknown:${String(type)}`;
  }
}

export function summarizeDrawableElements(elements: DrawableElement[]) {
  return summarizeElements(elements.length, (position) => ({
    index: elements[position]?.index ?? null,
    type: elements[position]?.type ?? null,
  }));
}

export function summarizeYDoc(doc: Y.Doc) {
  const elements = doc.getArray<Y.Map<unknown>>('elements');
  const meta = doc.getMap('meta');

  return {
    ...summarizeElements(elements.length, (position) => {
      const yMap = elements.get(position);
      return {
        index: (yMap?.get('index') as number | undefined) ?? null,
        type: (yMap?.get('type') as number | undefined) ?? null,
      };
    }),
    nextIndex: (meta.get('nextIndex') as number | undefined) ?? 0,
  };
}

export function summarizeYDocManager(ydoc: YDocManager) {
  return summarizeYDoc(ydoc.doc);
}

export function summarizeNoteBytes(bytes: Uint8Array | null | undefined) {
  if (!bytes || bytes.byteLength === 0) {
    return {
      byteLength: 0,
      hasBytes: false,
      ...summarizeYDoc(new Y.Doc()),
    };
  }

  const doc = new Y.Doc();
  Y.applyUpdate(doc, bytes);

  return {
    byteLength: bytes.byteLength,
    hasBytes: true,
    ...summarizeYDoc(doc),
  };
}
