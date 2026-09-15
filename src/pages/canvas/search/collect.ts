import type { Node as PMNode } from 'prosemirror-model';
import type { DrawableCanvas } from '@myelin/editor/drawable-canvas';
import type { SearchableElement } from '@myelin/editor/elements/canvas-searchable-element';
import { findTextMatches } from '@myelin/editor/page-frame/pm/search-highlight';
import type { RecognizedPage } from '@myelin/editor/platform';

export type CanvasSearchKind =
  | 'text'
  | 'page-frame'
  | 'transcript'
  | 'handwriting';

export interface CanvasSearchRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Page frames carry their reconstructed PM doc so occurrences can be enumerated with positions;
 * everything else carries plain text matched at the element/line level.
 */
export interface CanvasSearchSource {
  kind: CanvasSearchKind;
  rect: CanvasSearchRect;
  selectUuids: string[];
  frameUuid?: string;
  doc?: PMNode;
  text?: string;
}

/** One navigable match — an occurrence (page frame) or a whole element/line. */
export interface CanvasMatch {
  kind: CanvasSearchKind;
  rect: CanvasSearchRect;
  selectUuids: string[];
  frameUuid?: string;
  /** Occurrence index within the frame, in reading order (page frames only). */
  ordinalInFrame?: number;
}

function rectOf(box: DOMRect): CanvasSearchRect {
  return { x: box.x, y: box.y, width: box.width, height: box.height };
}

// Text, page frames and audio transcripts come live from the in-memory doc (always fresh);
// handwriting comes from the recognized artifact.
export function collectCanvasSearchSources(
  dc: DrawableCanvas,
  recognized: RecognizedPage | null,
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
    sources.push({
      kind: content.kind,
      rect: rectOf(element.boundingBox),
      selectUuids: [element.uuid],
      text: content.text,
    });
  }

  if (recognized) {
    for (const line of recognized.lines) {
      const text = line.text.trim();
      if (!text) {
        continue;
      }
      const [x, y, width, height] = line.bbox;
      sources.push({
        kind: 'handwriting',
        rect: { x, y, width, height },
        selectUuids: line.strokeIds,
        text,
      });
    }
  }

  return sources;
}

// Literal, case-insensitive. Page frames contribute one match per occurrence; other sources
// contribute one match when their text contains the query.
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
