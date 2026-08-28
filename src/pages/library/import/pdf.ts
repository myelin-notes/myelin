import { ElementType } from '@myelin/editor/elements/element-type';
import {
  PAGE_HEIGHT,
  PAGE_WIDTH,
} from '@myelin/editor/elements/page-frame-constants';
import {
  createDefaultPdfPageOrder,
  getPdfPageSizes,
  type PdfPageSize,
} from '@myelin/editor/pdf-renderer';
import type { YDocManager } from '@myelin/editor/ydoc-manager';
import type { Repository, VFSNodeId } from '@/lib/sync';
import { createCanvasFile } from './canvas-file';

export const PDF_FILE_ACCEPT = 'application/pdf,.pdf';
export const PDF_EXTENSION_RE = /\.pdf$/i;
const GOODNOTES_EXTENSION_RE = /\.goodnotes$/i;
const PDF_MIME_TYPES = new Set(['application/pdf']);
const DEFAULT_PDF_IMPORT_OFFSET = {
  x: 160,
  y: 80,
} as const;

export function isPdfFile(file: File): boolean {
  return PDF_EXTENSION_RE.test(file.name) || PDF_MIME_TYPES.has(file.type);
}

export function isNativeGoodnotesFile(file: File): boolean {
  return GOODNOTES_EXTENSION_RE.test(file.name);
}

function getPdfCanvasTitle(fileName: string, fallback: string): string {
  const title = fileName.replace(PDF_EXTENSION_RE, '').trim();
  return title.length > 0 ? title : fallback;
}

export function addPdfElementToYDoc(
  ydoc: YDocManager,
  bytes: Uint8Array,
  fileName: string,
  pageSizes: PdfPageSize[] = [{ w: PAGE_WIDTH, h: PAGE_HEIGHT }],
): string {
  const uuid = crypto.randomUUID();

  ydoc.insertElementMap(0, ElementType.PDF, uuid, {
    offsetX: DEFAULT_PDF_IMPORT_OFFSET.x,
    offsetY: DEFAULT_PDF_IMPORT_OFFSET.y,
    scaleX: 1,
    scaleY: 1,
    pdfData: new Uint8Array(bytes),
    pageSizes,
    pageOrder: createDefaultPdfPageOrder(pageSizes.length),
    fileName,
  });

  return uuid;
}

export async function importPdfFile({
  file,
  repository,
  parentId,
  fallbackTitle,
}: {
  file: File;
  repository: Repository;
  parentId: string | null;
  fallbackTitle: string;
}): Promise<VFSNodeId> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pageSizes = await getPdfPageSizes(bytes);
  return createCanvasFile({
    repository,
    parentId,
    title: getPdfCanvasTitle(file.name, fallbackTitle),
    label: 'PDF',
    build: (ydoc) => {
      addPdfElementToYDoc(ydoc, bytes, file.name, pageSizes);
    },
  });
}
