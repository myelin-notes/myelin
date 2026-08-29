import { ElementType } from '@myelin/editor/elements/element-type';
import type { YDocManager } from '@myelin/editor/ydoc-manager';
import { invoke } from '@tauri-apps/api/core';
import type { Repository, VFSNodeId } from '@/lib/sync';
import { createCanvasFile } from './canvas-file';

export const SAMSUNG_NOTES_DIALOG_FILTERS = [
  { name: 'Samsung Notes', extensions: ['sdocx'] },
];

const SDOCX_EXTENSION_RE = /\.sdocx$/i;

/** Shift the whole note clear of the origin, matching the other importers. */
const PAGE_ORIGIN = { x: 160, y: 80 } as const;

/** Vertical gap between stacked pages, in world px. */
const PAGE_GAP = 48;

const DEFAULT_TEXT_COLOR = '#1a1a1a';
const DEFAULT_FONT_PX = 16;

/**
 * Note title from the picked file's basename. Android hands back a
 * `content://` URI whose document id is percent-encoded, so decode before
 * taking the last segment.
 */
export function samsungNotesTitle(path: string): string {
  let decoded = path;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) {
    try {
      decoded = decodeURIComponent(path);
    } catch {
      // not percent-encoded; keep as-is
    }
  }
  const base = decoded.split(/[/\\]/).pop() ?? decoded;
  return base.replace(SDOCX_EXTENSION_RE, '') || 'Samsung Notes';
}

interface SamsungNotesStrokeElement {
  kind: 'stroke';
  /** Flat [x, y, pressure, ...] in page px; pressure 0..1, all zero when `hasPressure` is false. */
  points: number[];
  color: string;
  size: number;
  hasPressure: boolean;
}

interface SamsungNotesTextElement {
  kind: 'text';
  x: number;
  y: number;
  width: number;
  text: string;
}

type SamsungNotesElement = SamsungNotesStrokeElement | SamsungNotesTextElement;

export interface SamsungNotesPage {
  width: number;
  height: number;
  elements: SamsungNotesElement[];
}

export interface SamsungNotesNote {
  pages: SamsungNotesPage[];
  /** Parsed objects the import cannot represent yet (images, shapes, PDF backgrounds, ...). */
  skippedObjects: number;
}

export async function parseSamsungNotesFile(
  path: string,
): Promise<SamsungNotesNote> {
  return invoke<SamsungNotesNote>('parse_samsung_notes', { path });
}

export function countSamsungNotesElements(note: SamsungNotesNote): number {
  return note.pages.reduce((sum, page) => sum + page.elements.length, 0);
}

function offsetStrokePoints(
  points: number[],
  originX: number,
  originY: number,
): number[] {
  const out = points.slice();
  for (let i = 0; i < out.length; i += 3) {
    out[i] += originX;
    out[i + 1] += originY;
  }
  return out;
}

/** Pages stack vertically in one canvas, separated by `PAGE_GAP`. */
export function addSamsungNotesToYDoc(
  ydoc: YDocManager,
  note: SamsungNotesNote,
): void {
  let pageY = PAGE_ORIGIN.y;

  for (const page of note.pages) {
    for (const element of page.elements) {
      switch (element.kind) {
        case 'stroke':
          ydoc.createElementMap(ElementType.STROKE, crypto.randomUUID(), {
            offsetX: 0,
            offsetY: 0,
            scaleX: 1,
            scaleY: 1,
            color: element.color,
            size: element.size,
            hasPressure: element.hasPressure,
            points: offsetStrokePoints(element.points, PAGE_ORIGIN.x, pageY),
          });
          break;
        case 'text':
          ydoc.createElementMap(ElementType.TEXT, crypto.randomUUID(), {
            offsetX: element.x + PAGE_ORIGIN.x,
            offsetY: element.y + pageY,
            scaleX: 1,
            scaleY: 1,
            text: element.text,
            color: DEFAULT_TEXT_COLOR,
            fontSize: DEFAULT_FONT_PX,
            fontFamily: 'sans-serif',
            boxWidth: element.width || 400,
            boxHeight: 0,
          });
          break;
      }
    }

    pageY += page.height + PAGE_GAP;
  }
}

export async function importSamsungNotes({
  note,
  repository,
  parentId,
  title,
}: {
  note: SamsungNotesNote;
  repository: Repository;
  parentId: VFSNodeId | null;
  title: string;
}): Promise<VFSNodeId> {
  return createCanvasFile({
    repository,
    parentId,
    title,
    label: 'Samsung Notes',
    build: (ydoc) => addSamsungNotesToYDoc(ydoc, note),
  });
}
