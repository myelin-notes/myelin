import { addMarkdownPageFrameToYDoc } from '@myelin/editor/page-frame/markdown/import';
import type { Repository, VFSNodeId } from '@/lib/sync';
import { createCanvasFile } from './canvas-file';

export const MARKDOWN_FILE_ACCEPT =
  'text/markdown,text/x-markdown,.md,.markdown,.mdx';
export const MARKDOWN_EXTENSION_RE = /\.(md|markdown|mdx)$/i;
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
  const markdown = await file.text();
  return createCanvasFile({
    repository,
    parentId,
    title: getMarkdownCanvasTitle(file.name, fallbackTitle),
    label: 'Markdown',
    build: async (ydoc) => {
      await addMarkdownPageFrameToYDoc(ydoc, markdown, { repository });
    },
  });
}
