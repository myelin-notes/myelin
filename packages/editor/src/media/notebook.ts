import type { DrawableCanvas } from '../drawable-canvas';
import { notebookToMarkdown } from '../page-frame/markdown/notebook';
import type { MediaImportOptions } from './index';
import { markdownImportHandler } from './markdown';

/** Notebooks import as their markdown projection, so they land in a page frame
 * exactly the way a dropped .md file does. */
export async function notebookImportHandler(
  blob: Blob,
  canvas: DrawableCanvas,
  options: MediaImportOptions = {},
) {
  const markdown = notebookToMarkdown(await blob.text());
  await markdownImportHandler(
    new Blob([markdown], { type: 'text/markdown' }),
    canvas,
    options,
  );
}
