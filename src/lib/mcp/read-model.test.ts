import { describe, expect, it } from 'vitest';
import { ElementType } from '@myelin/editor/elements/element-type';
import { addMarkdownPageFrameToYDoc } from '@myelin/editor/page-frame/markdown/import';
import { YDocManager } from '@myelin/editor/ydoc-manager';
import { LocalRepository } from '@/lib/sync/repo/local';
import {
  buildMcpNoteReadModel,
  readMcpCanvasText,
  readMcpLatex,
  readMcpNoteFull,
  readMcpPageFrame,
  readMcpPdf,
} from './read-model';

async function createRepositoryNote() {
  const repository = new LocalRepository();
  await repository.initialize();
  const ydoc = new YDocManager();
  const pageFrameId = await addMarkdownPageFrameToYDoc(
    ydoc,
    '# Heading\n\nFrame body',
    { displayName: 'Main Frame' },
  );
  ydoc.createElementMap(ElementType.TEXT, 'text-1', {
    offsetX: 20,
    offsetY: 30,
    scaleX: 1,
    scaleY: 1,
    text: 'Floating text',
    color: '#123456',
    fontSize: 18,
    fontFamily: 'Inter',
    boxWidth: 180,
    boxHeight: 60,
  });
  ydoc.createElementMap(ElementType.IMAGE, 'image-1', {
    offsetX: 40,
    offsetY: 50,
    scaleX: 1,
    scaleY: 1,
    naturalWidth: 640,
    naturalHeight: 480,
    cropX: 10,
    cropY: 20,
    cropW: 300,
    cropH: 200,
    imageData: new Uint8Array([1, 2, 3, 4]),
  });
  ydoc.createElementMap(ElementType.PDF, 'pdf-1', {
    offsetX: 60,
    offsetY: 70,
    scaleX: 1,
    scaleY: 1,
    fileName: 'Paper.pdf',
    pageSizes: [
      { w: 600, h: 800 },
      { w: 600, h: 800 },
    ],
    pdfData: new Uint8Array([5, 6, 7]),
  });
  ydoc.createElementMap(ElementType.LATEX, 'latex-1', {
    offsetX: 80,
    offsetY: 90,
    scaleX: 1,
    scaleY: 1,
    latex: 'E = mc^2',
  });
  ydoc.createElementMap(ElementType.STROKE, 'stroke-1', {
    points: [0, 0, 0.5, 10, 10, 0.6, 20, 10, 0.7],
    color: '#000000',
    size: 5,
  });
  ydoc.createElementMap(999 as ElementType, 'unknown-1', {
    offsetX: 100,
    offsetY: 110,
    custom: 'value',
  });

  const noteId = await repository.createFile(
    'MCP Note',
    'mcanvas',
    null,
    ydoc.encodeState(),
  );

  return { repository, noteId, pageFrameId };
}

describe('MCP read model', () => {
  it('extracts staged note inventory from a canvas note', async () => {
    const { repository, noteId } = await createRepositoryNote();

    const note = await buildMcpNoteReadModel(repository, noteId, {
      indexedText: 'Indexed note text',
    });

    expect(note.note.title).toBe('MCP Note');
    expect(note.indexedText).toBe('Indexed note text');
    expect(note.elements.map((element) => element.kind)).toEqual([
      'page-frame',
      'text',
      'image',
      'pdf',
      'latex',
      'stroke',
      'unknown',
    ]);
    expect(note.elements[0]).toMatchObject({
      kind: 'page-frame',
      displayName: 'Main Frame',
      snippet: 'Heading\nFrame body',
    });
    expect(note.elements[1]).toMatchObject({
      kind: 'text',
      text: 'Floating text',
    });
    expect(note.elements[3]).toMatchObject({
      kind: 'pdf',
      fileName: 'Paper.pdf',
      pageCount: 2,
      textAvailable: false,
    });
  });

  it('reads full page-frame markdown by id', async () => {
    const { repository, noteId, pageFrameId } = await createRepositoryNote();

    const frame = await readMcpPageFrame(repository, noteId, pageFrameId);

    expect(frame.displayName).toBe('Main Frame');
    expect(frame.markdown).toContain('# Heading');
    expect(frame.plainText).toBe('Heading\nFrame body');
  });

  it('reads targeted non-page-frame elements', async () => {
    const { repository, noteId } = await createRepositoryNote();

    await expect(
      readMcpCanvasText(repository, noteId, 'text-1'),
    ).resolves.toMatchObject({
      text: 'Floating text',
    });
    await expect(
      readMcpLatex(repository, noteId, 'latex-1'),
    ).resolves.toMatchObject({
      latex: 'E = mc^2',
    });
    await expect(
      readMcpPdf(repository, noteId, 'pdf-1'),
    ).resolves.toMatchObject({
      fileName: 'Paper.pdf',
      textAvailable: false,
    });
  });

  it('reads the full note model in one pass', async () => {
    const { repository, noteId, pageFrameId } = await createRepositoryNote();

    const full = await readMcpNoteFull(repository, noteId, {
      indexedText: 'Indexed note text',
    });

    expect(full.indexedText).toBe('Indexed note text');
    expect(full.pageFrames).toEqual([
      expect.objectContaining({
        pageFrameId,
        plainText: 'Heading\nFrame body',
      }),
    ]);
    expect(full.canvasTexts).toEqual([
      expect.objectContaining({ elementId: 'text-1', text: 'Floating text' }),
    ]);
    expect(full.latexBlocks).toEqual([
      expect.objectContaining({ elementId: 'latex-1', latex: 'E = mc^2' }),
    ]);
  });
});
