import { ElementType } from '@myelin/editor/elements/element-type';
import type { YDocManager } from '@myelin/editor/ydoc-manager';
import { Logger } from '@myelin/shared/logger';
import { invoke } from '@tauri-apps/api/core';
import type { NoteSession, Repository, VFSNodeId } from '@/lib/sync';
import type { ImportProgress } from './dialog';

const logger = new Logger('OneNoteImport');

export const ONENOTE_FILE_ACCEPT = '.one';
const ONENOTE_EXTENSION_RE = /\.one$/i;

/** Rust returns page-relative CSS px; shift the whole page clear of the origin. */
const PAGE_ORIGIN = { x: 160, y: 80 } as const;

export function isOneNoteFile(file: File): boolean {
  return ONENOTE_EXTENSION_RE.test(file.name);
}

interface OneNoteTextElement {
  kind: 'text';
  x: number;
  y: number;
  width: number | null;
  text: string;
  fontSize: number;
  fontFamily: string | null;
  color: string;
}

interface OneNoteStroke {
  /** Flat [x, y, x, y, ...] in CSS px. */
  points: number[];
  color: string;
  size: number;
}

interface OneNoteInkElement {
  kind: 'ink';
  strokes: OneNoteStroke[];
}

interface OneNoteImageElement {
  kind: 'image';
  x: number;
  y: number;
  width: number | null;
  height: number | null;
  /** Base64 of the original image bytes. */
  data: string;
  altText: string | null;
}

type OneNoteElement =
  | OneNoteTextElement
  | OneNoteInkElement
  | OneNoteImageElement;

export interface OneNotePage {
  title: string | null;
  level: number;
  elements: OneNoteElement[];
}

export interface OneNoteSection {
  pages: OneNotePage[];
}

export interface OneNoteImportResult {
  rootFolderId: VFSNodeId;
  pagesImported: number;
  skippedPages: number;
}

export async function parseOneNoteSection(file: File): Promise<OneNoteSection> {
  // Sent as the raw invoke body: a JSON number array would balloon a
  // multi-megabyte section into tens of megabytes of text.
  const bytes = new Uint8Array(await file.arrayBuffer());
  return invoke<OneNoteSection>('parse_onenote_section', bytes);
}

function decodeBase64(data: string): Uint8Array<ArrayBuffer> {
  const binary = atob(data);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// perfect-freehand reads a flat [x, y, pressure, ...] buffer. OneNote keeps
// per-point pressure but the parser drops it, so every point gets 0 and
// `hasPressure: false` leaves the stroke at a uniform width.
function toStrokePoints(points: number[]): number[] {
  const out = new Array<number>((points.length / 2) * 3);
  for (let i = 0; i < points.length / 2; i++) {
    out[i * 3] = points[i * 2] + PAGE_ORIGIN.x;
    out[i * 3 + 1] = points[i * 2 + 1] + PAGE_ORIGIN.y;
    out[i * 3 + 2] = 0;
  }
  return out;
}

async function addImageElement(
  ydoc: YDocManager,
  element: OneNoteImageElement,
): Promise<void> {
  const bytes = decodeBase64(element.data);
  // createImageBitmap is the only way to learn the intrinsic size, and it also
  // rejects formats the canvas cannot draw — skip those rather than persist a
  // blank element.
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(new Blob([bytes]));
  } catch (error) {
    logger.warn('Skipping unreadable OneNote image', error);
    return;
  }

  const naturalWidth = bitmap.width;
  const naturalHeight = bitmap.height;
  bitmap.close();

  const scaleX = element.width ? element.width / naturalWidth : 1;
  const scaleY = element.height ? element.height / naturalHeight : 1;

  ydoc.createElementMap(ElementType.IMAGE, crypto.randomUUID(), {
    offsetX: element.x + PAGE_ORIGIN.x,
    offsetY: element.y + PAGE_ORIGIN.y,
    scaleX,
    scaleY,
    imageData: bytes,
    naturalWidth,
    naturalHeight,
    cropX: 0,
    cropY: 0,
    cropW: naturalWidth,
    cropH: naturalHeight,
  });
}

export async function addOneNotePageToYDoc(
  ydoc: YDocManager,
  page: OneNotePage,
): Promise<void> {
  for (const element of page.elements) {
    switch (element.kind) {
      case 'text':
        ydoc.createElementMap(ElementType.TEXT, crypto.randomUUID(), {
          offsetX: element.x + PAGE_ORIGIN.x,
          offsetY: element.y + PAGE_ORIGIN.y,
          scaleX: 1,
          scaleY: 1,
          text: element.text,
          color: element.color,
          fontSize: element.fontSize,
          fontFamily: element.fontFamily ?? 'sans-serif',
          boxWidth: element.width ?? 400,
          boxHeight: 0,
        });
        break;
      case 'ink':
        for (const stroke of element.strokes) {
          ydoc.createElementMap(ElementType.STROKE, crypto.randomUUID(), {
            offsetX: 0,
            offsetY: 0,
            scaleX: 1,
            scaleY: 1,
            color: stroke.color,
            size: stroke.size,
            hasPressure: false,
            points: toStrokePoints(stroke.points),
          });
        }
        break;
      case 'image':
        await addImageElement(ydoc, element);
        break;
    }
  }
}

function getPageTitle(page: OneNotePage, index: number, fallback: string) {
  const title = page.title?.trim();
  if (title) {
    return title;
  }
  return `${fallback} ${index + 1}`;
}

export async function importOneNoteSection({
  file,
  repository,
  parentId,
  sectionName,
  fallbackTitle,
  onProgress,
}: {
  file: File;
  repository: Repository;
  parentId: VFSNodeId | null;
  sectionName: string;
  fallbackTitle: string;
  onProgress?: (progress: ImportProgress) => void;
}): Promise<OneNoteImportResult> {
  const section = await parseOneNoteSection(file);
  const rootFolderId = await repository.createFolder(sectionName, parentId);

  let pagesImported = 0;
  let skippedPages = 0;

  for (const [index, page] of section.pages.entries()) {
    const title = getPageTitle(page, index, fallbackTitle);
    onProgress?.({
      current: index + 1,
      total: section.pages.length,
      fileName: title,
    });

    let createdId: VFSNodeId | null = null;
    let session: NoteSession | null = null;
    try {
      const name = await repository.getUniqueFileName(title, rootFolderId);
      createdId = await repository.createFile(name, 'mcanvas', rootFolderId);
      session = await repository.openSession(createdId);
      await addOneNotePageToYDoc(session.ydoc, page);
      await session.save();
      await session.close();
      session = null;
      createdId = null;
      pagesImported++;
    } catch (error) {
      logger.error('Failed to import OneNote page', error, { title });
      skippedPages++;
      if (session) {
        await session.close().catch(() => {});
      }
      if (createdId) {
        await repository.deleteNode(createdId).catch((deleteError) => {
          logger.error(
            'Failed to clean up failed OneNote page import',
            deleteError,
            { createdId },
          );
        });
      }
    }
  }

  return { rootFolderId, pagesImported, skippedPages };
}
