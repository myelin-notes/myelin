import { describe, expect, it } from 'vitest';
import { YDocManager } from '../ydoc-manager';
import { addMarkdownPageFrameToYDoc } from './markdown/import';
import { extractCanvasPreviewText } from './preview-text';

async function createNoteUpdate(markdown: string): Promise<Uint8Array> {
  const ydoc = new YDocManager();
  await addMarkdownPageFrameToYDoc(ydoc, markdown);
  return ydoc.encodeState();
}

describe('extractCanvasPreviewText', () => {
  it('extracts page-frame text from a stored canvas update', async () => {
    const update = await createNoteUpdate('# Research\n\nA short body.');

    expect(extractCanvasPreviewText(update)).toBe('Research\nA short body.');
  });

  it('returns an empty string for empty bytes', () => {
    expect(extractCanvasPreviewText(new Uint8Array())).toBe('');
  });
});
