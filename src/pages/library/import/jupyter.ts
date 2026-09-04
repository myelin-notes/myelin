import { notebookToMarkdown } from '@myelin/editor/page-frame/markdown/notebook';
import type { Repository, VFSNodeId } from '@/lib/sync';
import { createCanvasFromMarkdown } from './markdown';

export const JUPYTER_FILE_ACCEPT = '.ipynb,application/x-ipynb+json';
const JUPYTER_EXTENSION_RE = /\.ipynb$/i;

export function isJupyterFile(file: File): boolean {
  return (
    JUPYTER_EXTENSION_RE.test(file.name) ||
    file.type === 'application/x-ipynb+json'
  );
}

function getJupyterCanvasTitle(fileName: string, fallback: string): string {
  const title = fileName.replace(JUPYTER_EXTENSION_RE, '').trim();
  return title.length > 0 ? title : fallback;
}

export async function importJupyterFile({
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
  return createCanvasFromMarkdown({
    markdown: notebookToMarkdown(await file.text()),
    baseTitle: getJupyterCanvasTitle(file.name, fallbackTitle),
    repository,
    parentId,
  });
}
