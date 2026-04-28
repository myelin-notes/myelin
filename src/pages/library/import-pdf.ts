import { Logger } from '@/lib/logger';
import { loadDocument } from '@/lib/pdf-renderer';
import type { NoteSession, Repository } from '@/lib/sync';
import { ElementType } from '@/pages/canvas/elements/element-type';
import type {
  PdfPageEntry,
  PdfPageSize,
} from '@/pages/canvas/elements/pdf-element';
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

async function loadPdfPageSizes(bytes: Uint8Array): Promise<PdfPageSize[]> {
  const doc = await loadDocument(bytes);
  try {
    const pageSizes: PdfPageSize[] = [];
    for (let i = 0; i < doc.numPages; i++) {
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale: 1 });
      pageSizes.push({ w: viewport.width, h: viewport.height });
    }
    return pageSizes;
  } finally {
    doc.destroy();
  }
}

export function addPdfElementToYDoc(
  ydoc: YDocManager,
  bytes: Uint8Array,
  pageSizes: PdfPageSize[],
  fileName: string,
): number {
  const index = ydoc.nextIndex;
  const pageOrder: PdfPageEntry[] = pageSizes.map((_, i) => ({
    kind: 'pdf',
    originalIndex: i,
  }));

  ydoc.insertElementMap(0, ElementType.PDF, index, {
    offsetX: DEFAULT_PDF_IMPORT_OFFSET.x,
    offsetY: DEFAULT_PDF_IMPORT_OFFSET.y,
    scaleX: 1,
    scaleY: 1,
    pdfData: new Uint8Array(bytes),
    pageSizes,
    pageOrder,
    fileName,
  });

  ydoc.transact(() => {
    ydoc.nextIndex = Math.max(ydoc.nextIndex, index + 1);
  });

  return index;
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
}): Promise<string> {
  let createdId: string | null = null;
  let session: NoteSession | null = null;

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const pageSizes = await loadPdfPageSizes(bytes);
    const baseTitle = getPdfCanvasTitle(file.name, fallbackTitle);
    const title = await repository.getUniqueFileName(baseTitle, parentId);
    createdId = await repository.createFile(title, 'mcanvas', parentId);
    session = await repository.openSession(createdId);
    addPdfElementToYDoc(session.ydoc, bytes, pageSizes, file.name);
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
