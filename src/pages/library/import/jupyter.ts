import { addMarkdownPageFrameToYDoc } from '@myelin/editor/page-frame/markdown/import';
import type { NativeRepository, VFSNodeId } from '@/lib/sync';
import { createCanvasFile } from './canvas-file';

const JUPYTER_EXTENSION_RE = /\.ipynb$/i;

interface NotebookCell {
  cell_type: string;
  source: string | string[];
}

interface Notebook {
  cells?: NotebookCell[];
  metadata?: {
    kernelspec?: { language?: string };
    language_info?: { name?: string };
  };
}

export function isJupyterFile(file: Pick<File, 'name'>): boolean {
  return JUPYTER_EXTENSION_RE.test(file.name);
}

// Outputs are dropped: code block run output is in-memory only, so they come back on re-run.
// shortcut: nbformat 4 only (`cells` at the top level); v3 `worksheets` notebooks import empty.
export function notebookToMarkdown(json: string): string {
  const notebook = JSON.parse(json) as Notebook;
  const language =
    notebook.metadata?.kernelspec?.language ??
    notebook.metadata?.language_info?.name ??
    'python';

  return (notebook.cells ?? [])
    .map((cell) => {
      const source = (
        Array.isArray(cell.source) ? cell.source.join('') : cell.source
      ).trimEnd();
      if (cell.cell_type === 'markdown' || source.length === 0) {
        return source;
      }
      const info = cell.cell_type === 'code' ? language : '';
      return `\`\`\`${info}\n${source}\n\`\`\``;
    })
    .filter((block) => block.length > 0)
    .join('\n\n');
}

export async function importJupyterFile({
  file,
  repository,
  parentId,
  fallbackTitle,
}: {
  file: File;
  repository: NativeRepository;
  parentId: string | null;
  fallbackTitle: string;
}): Promise<VFSNodeId> {
  const markdown = notebookToMarkdown(await file.text());
  const title = file.name.replace(JUPYTER_EXTENSION_RE, '').trim();
  return createCanvasFile({
    repository,
    parentId,
    title: title.length > 0 ? title : fallbackTitle,
    label: 'Jupyter notebook',
    build: async (ydoc) => {
      await addMarkdownPageFrameToYDoc(ydoc, markdown, { repository });
    },
  });
}
