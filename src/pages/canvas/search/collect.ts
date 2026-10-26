import type { Node as PMNode } from 'prosemirror-model';
import type { DrawableCanvas } from '@myelin/editor/drawable-canvas';
import type { SearchableElement } from '@myelin/editor/elements/canvas-searchable-element';
import { findPdfTextMatches } from '@myelin/editor/elements/pdf/text-layer';
import { findTextMatches } from '@myelin/editor/page-frame/pm/search-highlight';

export type CanvasSearchKind = 'text' | 'page-frame' | 'transcript' | 'pdf';

export interface CanvasSearchRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Page frames carry their reconstructed PM doc and PDF pages their page text, so occurrences can be
 * enumerated; everything else carries plain text matched at the element/line level.
 */
export interface CanvasSearchSource {
  kind: CanvasSearchKind;
  rect: CanvasSearchRect;
  selectUuids: string[];
  frameUuid?: string;
  pagePosition?: number;
  doc?: PMNode;
  text?: string;
}

/** One navigable match — an occurrence (page frame, PDF page) or a whole element/line. */
export interface CanvasMatch {
  kind: CanvasSearchKind;
  rect: CanvasSearchRect;
  selectUuids: string[];
  frameUuid?: string;
  pagePosition?: number;
  /** Occurrence index within the frame or PDF page, in reading order. */
  ordinalInFrame?: number;
}

function rectOf(box: DOMRect): CanvasSearchRect {
  return { x: box.x, y: box.y, width: box.width, height: box.height };
}

export function collectCanvasSearchSources(
  dc: DrawableCanvas,
): CanvasSearchSource[] {
  const sources: CanvasSearchSource[] = [];

  for (const element of dc.elements) {
    const searchable = element as typeof element & Partial<SearchableElement>;
    const content = searchable.getCanvasSearchContent?.();
    if (!content) {
      continue;
    }
    if (content.kind === 'page-frame') {
      sources.push({
        kind: content.kind,
        rect: rectOf(element.boundingBox),
        selectUuids: [element.uuid],
        frameUuid: element.uuid,
        doc: content.doc,
      });
      continue;
    }
    if (content.kind === 'pdf') {
      for (const page of content.pages) {
        sources.push({
          kind: 'pdf',
          rect: rectOf(page.bounds),
          selectUuids: [element.uuid],
          frameUuid: element.uuid,
          pagePosition: page.position,
          text: page.text,
        });
      }
      continue;
    }
    sources.push({
      kind: content.kind,
      rect: rectOf(element.boundingBox),
      selectUuids: [element.uuid],
      text: content.text,
    });
  }

  return sources;
}

// Literal, case-insensitive. Page frames and PDF pages contribute one match per occurrence; other
// sources contribute one match when their text contains the query.
export function buildCanvasMatches(
  sources: CanvasSearchSource[],
  query: string,
): CanvasMatch[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return [];
  }

  const matches: CanvasMatch[] = [];
  for (const source of sources) {
    if (source.kind === 'page-frame' && source.doc) {
      const ranges = findTextMatches(source.doc, needle);
      for (let index = 0; index < ranges.length; index++) {
        matches.push({
          kind: 'page-frame',
          rect: source.rect,
          selectUuids: source.selectUuids,
          frameUuid: source.frameUuid,
          ordinalInFrame: index,
        });
      }
    } else if (source.kind === 'pdf' && source.text) {
      const count = findPdfTextMatches(source.text, needle).length;
      for (let index = 0; index < count; index++) {
        matches.push({
          kind: 'pdf',
          rect: source.rect,
          selectUuids: source.selectUuids,
          frameUuid: source.frameUuid,
          pagePosition: source.pagePosition,
          ordinalInFrame: index,
        });
      }
    } else if (source.text?.toLowerCase().includes(needle)) {
      matches.push({
        kind: source.kind,
        rect: source.rect,
        selectUuids: source.selectUuids,
      });
    }
  }
  return matches;
}
