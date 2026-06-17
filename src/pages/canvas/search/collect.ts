import type { Node as PMNode } from 'prosemirror-model';
import type { RecognizedPage } from '@/lib/handwriting';
import type { DrawableCanvas } from '../drawable-canvas';
import { AudioElement } from '../elements/audio/element';
import { PageFrameElement } from '../elements/page-frame-element';
import { TextElement } from '../elements/text/element';
import { findTextMatches } from '../page-frame/pm/search-highlight';

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
 * A searchable thing on the canvas. Page frames carry their reconstructed PM
 * doc so occurrences can be enumerated with positions; everything else carries
 * plain text matched at the element/line level.
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

/**
 * Collect the searchable sources for the open canvas. Text, page frames, and
 * audio transcripts come live from the in-memory doc (always fresh); handwriting
 * comes from the recognized artifact.
 */
export function collectCanvasSearchSources(
  dc: DrawableCanvas,
  recognized: RecognizedPage | null,
): CanvasSearchSource[] {
  const sources: CanvasSearchSource[] = [];

  for (const element of dc.elements) {
    if (element instanceof TextElement) {
      const text = element.text.trim();
      if (text) {
        sources.push({
          kind: 'text',
          rect: rectOf(element.boundingBox),
          selectUuids: [element.uuid],
          text,
        });
      }
    } else if (element instanceof PageFrameElement) {
      // The frame's live editor doc is already in memory (views are kept
      // mounted for every frame), so read it instead of rebuilding the PM tree
      // from Yjs. Falls back to fragment reconstruction for a not-yet-mounted
      // frame and returns null when the frame is empty.
      const doc = element.getCurrentDoc();
      if (doc) {
        sources.push({
          kind: 'page-frame',
          rect: rectOf(element.boundingBox),
          selectUuids: [element.uuid],
          frameUuid: element.uuid,
          doc,
        });
      }
    } else if (element instanceof AudioElement) {
      const text = element.transcript.trim();
      if (text) {
        sources.push({
          kind: 'transcript',
          rect: rectOf(element.boundingBox),
          selectUuids: [element.uuid],
          text,
        });
      }
    }
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

/**
 * Expand sources into a flat, ordered list of matches for `query` (literal,
 * case-insensitive). Page frames contribute one match per occurrence; other
 * sources contribute one match when their text contains the query.
 */
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
