import { Logger } from '@/lib/logger';
import type { FileId, NoteSession, Repository } from '@/lib/sync';
import { ElementType } from '@/pages/canvas/elements/element-type';
import {
  PAGE_HEIGHT,
  PAGE_WIDTH,
} from '@/pages/canvas/elements/page-frame-constants';
import {
  createDefaultPdfPageOrder,
  getPdfPageSizes,
  type PdfPageSize,
} from '@/pages/canvas/pdf-renderer';
import type { YDocManager } from '@/pages/canvas/ydoc-manager';

const logger = new Logger('PdfImport');
export const PDF_FILE_ACCEPT = 'application/pdf,.pdf';
const PDF_EXTENSION_RE = /\.pdf$/i;
const PDF_MIME_TYPES = new Set(['application/pdf']);
const DEFAULT_PDF_IMPORT_OFFSET = {
  x: 160,
  y: 80,
} as const;

export function isPdfFile(file: File): boolean {
  return PDF_EXTENSION_RE.test(file.name) || PDF_MIME_TYPES.has(file.type);
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
}): Promise<FileId> {
  let createdId: FileId | null = null;
  let session: NoteSession | null = null;

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const pageSizes = await getPdfPageSizes(bytes);
    const baseTitle = getPdfCanvasTitle(file.name, fallbackTitle);
    const title = await repository.getUniqueFileName(baseTitle, parentId);
    createdId = await repository.createFile(title, 'mcanvas', parentId);
    session = await repository.openSession(createdId);
    addPdfElementToYDoc(session.ydoc, bytes, file.name, pageSizes);
    await session.save();
    await session.close();
    session = null;

    const importedId = createdId;
    createdId = null;
    return importedId;
  } catch (error) {
    logger.error('Failed to import PDF', error, {
      fileName: file.name,
      createdId,
    });
    if (session) {
      await session.close().catch(() => {});
    }
    if (createdId) {
      await repository.deleteNode(createdId).catch((deleteError) => {
        logger.error('Failed to clean up failed PDF import', deleteError, {
          createdId,
        });
      });
    }
    throw error;
  }
}
