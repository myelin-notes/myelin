import { describe, expect, it, vi } from 'vitest';
import type { NoteSession, Repository } from '@/lib/sync';
import { ElementType } from '@/pages/canvas/elements/element-type';
import {
  PAGE_HEIGHT,
  PAGE_WIDTH,
} from '@/pages/canvas/elements/page-frame-constants';
import { YDocManager } from '@/pages/canvas/ydoc-manager';
import { importPdfFile, isPdfFile } from './import-pdf';

vi.mock('@/pages/canvas/pdf-renderer', () => ({
  createDefaultPdfPageOrder: (pageCount: number) =>
    Array.from({ length: pageCount }, (_, originalIndex) => ({
      kind: 'pdf',
      originalIndex,
    })),
  getPdfPageSizes: vi.fn(async () => [{ w: 680, h: 880 }]),
}));

function createRepository(session: Partial<NoteSession>) {
  return {
    getUniqueFileName: vi.fn(async (name: string) => name),
    createFile: vi.fn(async () => 'canvas-1'),
    openSession: vi.fn(async () => session as NoteSession),
    deleteNode: vi.fn(async () => {}),
  } as unknown as Repository;
}

describe('PDF library import', () => {
  it('detects PDF files by extension or MIME type', () => {
    expect(isPdfFile(new File([], 'paper.PDF', { type: '' }))).toBe(true);
    expect(isPdfFile(new File([], 'paper', { type: 'application/pdf' }))).toBe(
      true,
    );
    expect(isPdfFile(new File([], 'paper.txt', { type: 'text/plain' }))).toBe(
      false,
    );
  });

  it('creates a canvas containing one PDF element', async () => {
    const ydoc = new YDocManager();
    const session = {
      ydoc,
      save: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
    };
    const repository = createRepository(session);

    const importedId = await importPdfFile({
      file: new File([new Uint8Array([1, 2, 3])], 'Deck.pdf', {
        type: 'application/pdf',
      }),
      repository,
      parentId: 'folder-1',
      fallbackTitle: 'Untitled Canvas',
    });

    expect(importedId).toBe('canvas-1');
    expect(repository.getUniqueFileName).toHaveBeenCalledWith(
      'Deck',
      'folder-1',
    );
    expect(repository.createFile).toHaveBeenCalledWith(
      'Deck',
      'mcanvas',
      'folder-1',
    );
    expect(repository.openSession).toHaveBeenCalledWith('canvas-1');
    expect(session.save).toHaveBeenCalledTimes(1);
    expect(session.close).toHaveBeenCalledTimes(1);

    expect(ydoc.elements.length).toBe(1);
    const pdfElement = ydoc.elements.get(0);
    expect(pdfElement.get('type')).toBe(ElementType.PDF);
    expect(typeof pdfElement.get('uuid')).toBe('string');
    expect(pdfElement.get('offsetX')).toBe(160);
    expect(pdfElement.get('offsetY')).toBe(80);
    expect(pdfElement.get('scaleX')).toBe(1);
    expect(pdfElement.get('scaleY')).toBe(1);
    expect(pdfElement.get('fileName')).toBe('Deck.pdf');
    expect(Array.from(pdfElement.get('pdfData') as Uint8Array)).toEqual([
      1, 2, 3,
    ]);
    expect(pdfElement.get('pageSizes')).toEqual([
      { w: PAGE_WIDTH, h: PAGE_HEIGHT },
    ]);
    expect(pdfElement.get('pageOrder')).toEqual([
      { kind: 'pdf', originalIndex: 0 },
    ]);
  });

  it('deletes the canvas if saving the imported PDF fails', async () => {
    const error = new Error('save failed');
    const session = {
      ydoc: new YDocManager(),
      save: vi.fn(async () => {
        throw error;
      }),
      close: vi.fn(async () => {}),
    };
    const repository = createRepository(session);

    await expect(
      importPdfFile({
        file: new File([new Uint8Array([1])], 'Deck.pdf', {
          type: 'application/pdf',
        }),
        repository,
        parentId: null,
        fallbackTitle: 'Untitled Canvas',
      }),
    ).rejects.toThrow(error);

    expect(session.close).toHaveBeenCalledTimes(1);
    expect(repository.deleteNode).toHaveBeenCalledWith('canvas-1');
  });
});
