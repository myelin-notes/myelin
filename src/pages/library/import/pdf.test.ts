import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { ElementType } from '@myelin/editor/elements/element-type';
import {
  PAGE_HEIGHT,
  PAGE_WIDTH,
} from '@myelin/editor/elements/page-frame-constants';
import { YDocManager } from '@myelin/editor/ydoc-manager';
import type { NativeRepository } from '@/lib/sync';
import { importPdfFile, isNativeGoodnotesFile, isPdfFile } from './pdf';

vi.mock('@myelin/editor/pdf-renderer', () => ({
  createDefaultPdfPageOrder: (pageCount: number) =>
    Array.from({ length: pageCount }, (_, originalIndex) => ({
      kind: 'pdf',
      originalIndex,
    })),
  getPdfPageSizes: vi.fn(async () => [{ w: 680, h: 880 }]),
}));

function createRepository() {
  return {
    getUniqueFileName: vi.fn(async (name: string) => name),
    createFile: vi.fn(async () => 'canvas-1'),
    deleteNode: vi.fn(async () => {}),
  } as unknown as NativeRepository;
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

  it('detects native Goodnotes documents separately from PDFs', () => {
    const nativeDocument = new File([], 'Lecture.goodnotes', { type: '' });

    expect(isNativeGoodnotesFile(nativeDocument)).toBe(true);
    expect(isPdfFile(nativeDocument)).toBe(false);
  });

  it('creates a canvas containing one PDF element', async () => {
    const repository = createRepository();

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
      expect.any(Uint8Array),
    );
    const ydoc = new YDocManager();
    const bytes = vi.mocked(repository.createFile).mock.calls[0][3]!;
    Y.applyUpdate(ydoc.doc, bytes);

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

  it('does not publish a canvas if its initial bytes cannot be saved', async () => {
    const error = new Error('save failed');
    const repository = createRepository();
    vi.mocked(repository.createFile).mockRejectedValueOnce(error);
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
    expect(repository.deleteNode).not.toHaveBeenCalled();
  });
});
