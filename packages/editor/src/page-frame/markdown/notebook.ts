/**
 * Converts a Jupyter notebook (nbformat 4) to markdown so it can go through the
 * ordinary page-frame markdown import. Markdown cells contribute their source
 * verbatim; code cells become fenced blocks tagged with the notebook's kernel
 * language. Saved cell outputs are not carried over -- the code blocks are
 * runnable, so output is regenerated rather than imported.
 */

interface NotebookCell {
  cell_type?: unknown;
  source?: unknown;
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : null;

const asString = (value: unknown): string | null =>
  typeof value === 'string' ? value : null;

export function notebookToMarkdown(source: string): string {
  let notebook: unknown;
  try {
    notebook = JSON.parse(source);
  } catch {
    throw new Error('This file is not valid JSON, so it is not a notebook.');
  }

  const cells = asRecord(notebook)?.cells;
  if (!Array.isArray(cells)) {
    throw new Error(
      'This file has no "cells" list, so it is not an nbformat 4 notebook.',
    );
  }

  const language = readLanguage(notebook);
  const blocks: string[] = [];
  for (const cell of cells) {
    const text = readCellSource(cell).trimEnd();
    // Empty cells are common and would otherwise import as blank paragraphs.
    if (text.trim() === '') {
      continue;
    }
    blocks.push(
      readCellType(cell) === 'code' ? fenceCode(text, language) : text,
    );
  }

  return blocks.join('\n\n');
}

/**
 * The fence language for code cells. Notebooks record it per notebook rather
 * than per cell; an empty string still produces a valid untagged fence.
 */
function readLanguage(notebook: unknown): string {
  const metadata = asRecord(asRecord(notebook)?.metadata);
  const fromLanguageInfo = asString(asRecord(metadata?.language_info)?.name);
  const fromKernelspec = asString(asRecord(metadata?.kernelspec)?.language);
  return (fromLanguageInfo ?? fromKernelspec ?? '').trim().toLowerCase();
}

function readCellType(cell: unknown): string {
  return asString((cell as NotebookCell)?.cell_type) ?? '';
}

/** Cell source is a string or, more commonly, a list of lines that already
 * carry their own newlines. */
function readCellSource(cell: unknown): string {
  const source = (cell as NotebookCell)?.source;
  if (typeof source === 'string') {
    return source;
  }
  if (Array.isArray(source)) {
    return source.filter((line) => typeof line === 'string').join('');
  }
  return '';
}

function fenceCode(code: string, language: string): string {
  // The fence has to outrun the longest backtick run in the code, or a cell
  // containing a fenced block of its own would close the block early.
  const longestRun = (code.match(/`+/g) ?? []).reduce(
    (longest, run) => Math.max(longest, run.length),
    0,
  );
  const fence = '`'.repeat(Math.max(3, longestRun + 1));
  return `${fence}${language}\n${code}\n${fence}`;
}
