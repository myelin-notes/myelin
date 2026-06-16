import { yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror';
import type { RecognizedPage } from '@/lib/handwriting';
import type { DrawableCanvas } from '../drawable-canvas';
import { AudioElement } from '../elements/audio/element';
import { PageFrameElement } from '../elements/page-frame-element';
import { TextElement } from '../elements/text/element';
import { schema } from '../page-frame/pm/schema';

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

export interface CanvasSearchItem {
  id: string;
  kind: CanvasSearchKind;
  /** Full searchable text. */
  text: string;
  /** World-space rect to animate the viewport to on navigation. */
  rect: CanvasSearchRect;
  /** Element or stroke uuids to select on navigation. */
  selectUuids: string[];
}

function rectOf(box: DOMRect): CanvasSearchRect {
  return { x: box.x, y: box.y, width: box.width, height: box.height };
}

function pageFrameText(dc: DrawableCanvas, uuid: string): string {
  const fragment = dc.ydoc.getXmlFragment(uuid);
  if (fragment.length === 0) {
    return '';
  }
  const doc = yXmlFragmentToProseMirrorRootNode(fragment, schema);
  return doc.textBetween(0, doc.content.size, '\n', ' ').trim();
}

/**
 * Build the searchable items for the open canvas. Text, page frames, and audio
 * transcripts are read live from the in-memory doc (always fresh); handwriting
 * comes from the recognized artifact (debounce-latent, which is fine for OCR).
 * Each item carries a world-space rect and the uuids to select so a hit can
 * pan the viewport to it and highlight it.
 */
export function collectCanvasSearchItems(
  dc: DrawableCanvas,
  recognized: RecognizedPage | null,
): CanvasSearchItem[] {
  const items: CanvasSearchItem[] = [];

  for (const element of dc.elements) {
    if (element instanceof TextElement) {
      const text = element.text.trim();
      if (text) {
        items.push({
          id: element.uuid,
          kind: 'text',
          text,
          rect: rectOf(element.boundingBox),
          selectUuids: [element.uuid],
        });
      }
    } else if (element instanceof PageFrameElement) {
      const text = pageFrameText(dc, element.uuid);
      if (text) {
        items.push({
          id: element.uuid,
          kind: 'page-frame',
          text,
          rect: rectOf(element.boundingBox),
          selectUuids: [element.uuid],
        });
      }
    } else if (element instanceof AudioElement) {
      const text = element.transcript.trim();
      if (text) {
        items.push({
          id: element.uuid,
          kind: 'transcript',
          text,
          rect: rectOf(element.boundingBox),
          selectUuids: [element.uuid],
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
      items.push({
        id: `hw:${line.hash}`,
        kind: 'handwriting',
        text,
        rect: { x, y, width, height },
        selectUuids: line.strokeIds,
      });
    }
  }

  return items;
}
