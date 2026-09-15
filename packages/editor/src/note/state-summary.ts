import type * as Y from 'yjs';
import type { DrawableElement } from '../elements/drawable-element';
import {
  ELEMENT_DESCRIPTORS,
  getElementDescriptor,
} from '../elements/element-descriptors';
import type { YDocManager } from '../ydoc-manager';

const MAX_SAMPLED_ELEMENTS = 20;
const MAX_UUID_SAMPLES = 50;

interface SampledElement {
  position: number;
  uuid: string | null;
  type: string;
}

interface ElementCounts {
  elementCounts: Record<string, number>;
  strokeCount: number;
  textCount: number;
  imageCount: number;
  pageFrameCount: number;
  pdfCount: number;
  unknownCount: number;
}

function createEmptyCounts(): ElementCounts {
  const elementCounts = Object.fromEntries(
    ELEMENT_DESCRIPTORS.map((descriptor) => [descriptor.name, 0]),
  ) as Record<string, number>;
  return {
    elementCounts,
    strokeCount: elementCounts.stroke ?? 0,
    textCount: elementCounts.text ?? 0,
    imageCount: elementCounts.image ?? 0,
    pageFrameCount: elementCounts['page-frame'] ?? 0,
    pdfCount: elementCounts.pdf ?? 0,
    unknownCount: 0,
  };
}

function appendUuidSample(samples: string[], uuid: string | null): void {
  if (typeof uuid !== 'string' || samples.length >= MAX_UUID_SAMPLES) {
    return;
  }

  samples.push(uuid);
}

function summarizeElements(
  elementCount: number,
  readElement: (position: number) => {
    uuid: string | null;
    type: number | null;
  },
) {
  const counts = createEmptyCounts();
  const sampledElements: SampledElement[] = [];
  const pageFrameUuids: string[] = [];
  const strokeUuids: string[] = [];

  for (let position = 0; position < elementCount; position++) {
    const descriptor = readElement(position);
    const type = descriptor.type;
    const elementDescriptor = getElementDescriptor(type);
    const typeLabel = elementDescriptor?.name ?? describeElementType(type);

    if (elementDescriptor) {
      counts.elementCounts[elementDescriptor.name] += 1;
      if (elementDescriptor.summaryUuidSample === 'stroke') {
        appendUuidSample(strokeUuids, descriptor.uuid);
      }
      if (elementDescriptor.summaryUuidSample === 'page-frame') {
        appendUuidSample(pageFrameUuids, descriptor.uuid);
      }
    } else {
      counts.unknownCount += 1;
    }

    if (sampledElements.length < MAX_SAMPLED_ELEMENTS) {
      sampledElements.push({
        position,
        uuid: descriptor.uuid,
        type: typeLabel,
      });
    }
  }

  return {
    elementCount,
    ...counts,
    strokeCount: counts.elementCounts.stroke ?? 0,
    textCount: counts.elementCounts.text ?? 0,
    imageCount: counts.elementCounts.image ?? 0,
    pageFrameCount: counts.elementCounts['page-frame'] ?? 0,
    pdfCount: counts.elementCounts.pdf ?? 0,
    pageFrameUuids,
    strokeUuids,
    sampledElements,
    sampledElementOverflow: Math.max(0, elementCount - sampledElements.length),
  };
}

export function describeElementType(type: number | null | undefined): string {
  return getElementDescriptor(type)?.name ?? `unknown:${String(type)}`;
}

export function summarizeDrawableElements(
  elements: readonly DrawableElement[],
) {
  return summarizeElements(elements.length, (position) => ({
    uuid: elements[position]?.uuid ?? null,
    type: elements[position]?.type ?? null,
  }));
}

export function summarizeYDoc(doc: Y.Doc) {
  const elements = doc.getArray<Y.Map<unknown>>('elements');

  return summarizeElements(elements.length, (position) => {
    const yMap = elements.get(position);
    return {
      uuid: (yMap?.get('uuid') as string | undefined) ?? null,
      type: (yMap?.get('type') as number | undefined) ?? null,
    };
  });
}

export function summarizeYDocManager(ydoc: YDocManager) {
  return summarizeYDoc(ydoc.doc);
}
