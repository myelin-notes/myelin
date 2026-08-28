import { ElementType } from '@myelin/editor/elements/element-type';
import type { YDocManager } from '@myelin/editor/ydoc-manager';
import { Logger } from '@myelin/shared/logger';
import { invoke } from '@tauri-apps/api/core';
import type { Repository, VFSNodeId } from '@/lib/sync';
import { createCanvasFile } from './canvas-file';
import type { ImportProgress } from './dialog';
import { addFolderAncestors, createImportedFolders } from './import-tree';

const logger = new Logger('OneNoteImport');

export const ONENOTE_DIALOG_FILTERS = [
  { name: 'OneNote', extensions: ['one', 'onepkg'] },
];

const ONENOTE_EXTENSION_RE = /\.(one|onepkg)$/i;

/** Rust returns page-relative CSS px; shift the whole page clear of the origin. */
const PAGE_ORIGIN = { x: 160, y: 80 } as const;

/**
 * Root folder name for the import: the picked file's basename without the
 * OneNote extension. Android hands back a `content://` URI whose document id is
 * percent-encoded, so decode before taking the last segment.
 */
export function oneNoteRootName(path: string): string {
  let decoded = path;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) {
    try {
      decoded = decodeURIComponent(path);
    } catch {
      // not percent-encoded; keep as-is
    }
  }
  const base = decoded.split(/[/\\]/).pop() ?? decoded;
  return base.replace(ONENOTE_EXTENSION_RE, '') || 'OneNote';
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
  /** '/'-separated section-group path, empty at the notebook's top level. */
  folderPath: string;
  name: string;
  pages: OneNotePage[];
}

export interface OneNoteNotebook {
  sections: OneNoteSection[];
}

export interface OneNoteImportResult {
  rootFolderId: VFSNodeId;
  pagesImported: number;
  skippedPages: number;
}

export async function parseOneNoteFile(path: string): Promise<OneNoteNotebook> {
  // Rust reads the file itself: Android cannot carry a raw invoke body, and a
  // JSON number array would balloon a multi-megabyte notebook.
  return invoke<OneNoteNotebook>('parse_onenote', { path });
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

function getSectionPath(section: OneNoteSection): string {
  return section.folderPath
    ? `${section.folderPath}/${section.name}`
    : section.name;
}

function collectFolderPaths(sections: OneNoteSection[]): Set<string> {
  const paths = new Set<string>();
  for (const section of sections) {
    addFolderAncestors(paths, getSectionPath(section));
  }
  return paths;
}

export function countOneNotePages(notebook: OneNoteNotebook): number {
  return notebook.sections.reduce(
    (sum, section) => sum + section.pages.length,
    0,
  );
}

export async function importOneNote({
  notebook,
  repository,
  parentId,
  rootName,
  fallbackTitle,
  onProgress,
}: {
  notebook: OneNoteNotebook;
  repository: Repository;
  parentId: VFSNodeId | null;
  rootName: string;
  fallbackTitle: string;
  onProgress?: (progress: ImportProgress) => void;
}): Promise<OneNoteImportResult> {
  const rootFolderId = await repository.createFolder(rootName, parentId);

  // A lone top-level section is a bare .one file: its pages belong directly in
  // the root folder rather than in a subfolder repeating the same name.
  const flat =
    notebook.sections.length === 1 && notebook.sections[0].folderPath === '';
  const folderIds = flat
    ? new Map<string, VFSNodeId>()
    : await createImportedFolders(
        repository,
        rootFolderId,
        collectFolderPaths(notebook.sections),
      );

  const totalPages = countOneNotePages(notebook);

  let pagesImported = 0;
  let skippedPages = 0;
  let processed = 0;

  for (const section of notebook.sections) {
    const sectionFolderId = flat
      ? rootFolderId
      : (folderIds.get(getSectionPath(section)) ?? rootFolderId);

    for (const [index, page] of section.pages.entries()) {
      const title = getPageTitle(page, index, fallbackTitle);
      processed++;
      onProgress?.({ current: processed, total: totalPages, fileName: title });

      // A page that fails is skipped rather than aborting the notebook.
      try {
        await createCanvasFile({
          repository,
          parentId: sectionFolderId,
          title,
          label: 'OneNote page',
          build: (ydoc) => addOneNotePageToYDoc(ydoc, page),
        });
        pagesImported++;
      } catch {
        skippedPages++;
      }
    }
  }

  return { rootFolderId, pagesImported, skippedPages };
}
