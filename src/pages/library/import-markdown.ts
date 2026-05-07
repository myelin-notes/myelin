import { Logger } from '@/lib/logger';
import type { NoteSession, Repository, VFSNodeId } from '@/lib/sync';
import { addMarkdownPageFrameToYDoc } from '@/pages/canvas/page-frame/markdown-import';

const logger = new Logger('MarkdownImport');
export const MARKDOWN_FILE_ACCEPT =
  'text/markdown,text/x-markdown,.md,.markdown,.mdx';
const MARKDOWN_EXTENSION_RE = /\.(md|markdown|mdx)$/i;
const MARKDOWN_MIME_TYPES = new Set(['text/markdown', 'text/x-markdown']);

export function isMarkdownFile(file: File): boolean {
  return (
    MARKDOWN_EXTENSION_RE.test(file.name) || MARKDOWN_MIME_TYPES.has(file.type)
  );
}

function getMarkdownCanvasTitle(fileName: string, fallback: string): string {
  const title = fileName.replace(MARKDOWN_EXTENSION_RE, '').trim();
  return title.length > 0 ? title : fallback;
}

export async function importMarkdownFile({
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
  let createdId: VFSNodeId | null = null;
  let session: NoteSession | null = null;

  try {
    const markdown = await file.text();
    const baseTitle = getMarkdownCanvasTitle(file.name, fallbackTitle);
    const title = await repository.getUniqueFileName(baseTitle, parentId);
    createdId = await repository.createFile(title, 'mcanvas', parentId);
    session = await repository.openSession(createdId);
    await addMarkdownPageFrameToYDoc(session.ydoc, markdown, { repository });
    await session.save();
    await session.close();
    session = null;

    const importedId = createdId;
    createdId = null;
    return importedId;
  } catch (error) {
    logger.error('Failed to import Markdown', error, {
      fileName: file.name,
      createdId,
    });
    if (session) {
      await session.close().catch(() => {});
    }
    if (createdId) {
      await repository.deleteNode(createdId).catch((deleteError) => {
        logger.error('Failed to clean up failed Markdown import', deleteError, {
          createdId,
        });
      });
    }
    throw error;
  }
}
