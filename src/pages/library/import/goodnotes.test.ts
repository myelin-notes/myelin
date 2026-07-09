import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ElementType } from '@myelin/editor/elements/element-type';
import { LocalRepository } from '@/lib/sync/repo/local';
import {
  getRepositoryTestStorage,
  resetRepositoryTestDoubles,
} from '@/test/repository-test-utils';
import { importGoodnotesZip, isZipFile } from './goodnotes';

vi.mock('@myelin/editor/pdf-renderer', () => ({
  createDefaultPdfPageOrder: (pageCount: number) =>
    Array.from({ length: pageCount }, (_, originalIndex) => ({
      kind: 'pdf',
      originalIndex,
    })),
  getPdfPageSizes: vi.fn(async () => [{ w: 680, h: 880 }]),
}));

interface ZipEntryInput {
  path: string;
  bytes: Uint8Array;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

function writeUInt16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true);
}

function writeUInt32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value, true);
}

function createStoredZip(entries: ZipEntryInput[]): Uint8Array {
  const encoder = new TextEncoder();
  const localChunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.path);
    const checksum = crc32(entry.bytes);
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(localHeader.buffer);

    writeUInt32(localView, 0, 0x04034b50);
    writeUInt16(localView, 4, 20);
    writeUInt16(localView, 6, 0);
    writeUInt16(localView, 8, 0);
    writeUInt16(localView, 10, 0);
    writeUInt16(localView, 12, 0);
    writeUInt32(localView, 14, checksum);
    writeUInt32(localView, 18, entry.bytes.length);
    writeUInt32(localView, 22, entry.bytes.length);
    writeUInt16(localView, 26, nameBytes.length);
    writeUInt16(localView, 28, 0);
    localHeader.set(nameBytes, 30);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(centralHeader.buffer);
    writeUInt32(centralView, 0, 0x02014b50);
    writeUInt16(centralView, 4, 20);
    writeUInt16(centralView, 6, 20);
    writeUInt16(centralView, 8, 0);
    writeUInt16(centralView, 10, 0);
    writeUInt16(centralView, 12, 0);
    writeUInt16(centralView, 14, 0);
    writeUInt32(centralView, 16, checksum);
    writeUInt32(centralView, 20, entry.bytes.length);
    writeUInt32(centralView, 24, entry.bytes.length);
    writeUInt16(centralView, 28, nameBytes.length);
    writeUInt16(centralView, 30, 0);
    writeUInt16(centralView, 32, 0);
    writeUInt16(centralView, 34, 0);
    writeUInt16(centralView, 36, 0);
    writeUInt32(centralView, 38, 0);
    writeUInt32(centralView, 42, localOffset);
    centralHeader.set(nameBytes, 46);

    localChunks.push(localHeader, entry.bytes);
    centralChunks.push(centralHeader);
    localOffset += localHeader.length + entry.bytes.length;
  }

  const centralDirectory = concatBytes(centralChunks);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  writeUInt32(endView, 0, 0x06054b50);
  writeUInt16(endView, 4, 0);
  writeUInt16(endView, 6, 0);
  writeUInt16(endView, 8, entries.length);
  writeUInt16(endView, 10, entries.length);
  writeUInt32(endView, 12, centralDirectory.length);
  writeUInt32(endView, 16, localOffset);
  writeUInt16(endView, 20, 0);

  return concatBytes([...localChunks, centralDirectory, end]);
}

describe('Goodnotes ZIP import', () => {
  beforeEach(() => {
    resetRepositoryTestDoubles();
  });

  it('detects ZIP files by extension or MIME type', () => {
    expect(isZipFile(new File([], 'Notebook.ZIP', { type: '' }))).toBe(true);
    expect(
      isZipFile(new File([], 'Notebook', { type: 'application/zip' })),
    ).toBe(true);
    expect(isZipFile(new File([], 'Notebook.goodnotes', { type: '' }))).toBe(
      false,
    );
  });

  it('imports PDFs from a ZIP while preserving folder structure', async () => {
    getRepositoryTestStorage();
    const repository = new LocalRepository('goodnotes-zip-import');
    const zipFile = new File(
      [
        createStoredZip([
          { path: 'Math/Week 1.pdf', bytes: new Uint8Array([1, 2, 3]) },
          { path: 'Math/Units/Week 2.PDF', bytes: new Uint8Array([4, 5, 6]) },
          { path: 'Math/notes.txt', bytes: new Uint8Array([7]) },
          { path: '__MACOSX/._Week 1.pdf', bytes: new Uint8Array([8]) },
        ]),
      ],
      'Goodnotes Export.zip',
      { type: 'application/zip' },
    );

    const result = await importGoodnotesZip({
      file: zipFile,
      repository,
      parentId: null,
      fallbackTitle: 'Untitled Canvas',
    });

    expect(result.pdfsImported).toBe(2);
    expect(result.skippedFiles).toBe(1);

    const [rootFolders] = await repository.listDirectory(null);
    expect(rootFolders.map((folder) => folder.name)).toEqual(['Math']);
    expect(rootFolders[0].id).toBe(result.focusFolderId);

    const mathFolder = rootFolders[0];
    const [mathFolders, mathFiles] = await repository.listDirectory(
      mathFolder.id,
    );
    expect(mathFolders.map((folder) => folder.name)).toEqual(['Units']);
    expect(mathFiles.map((file) => file.name)).toEqual(['Week 1']);

    const [unitFolders, unitFiles] = await repository.listDirectory(
      mathFolders[0].id,
    );
    expect(unitFolders).toEqual([]);
    expect(unitFiles.map((file) => file.name)).toEqual(['Week 2']);

    const session = await repository.openSession(unitFiles[0].id);
    try {
      const pdfElement = session.ydoc.elements.get(0);
      expect(pdfElement.get('type')).toBe(ElementType.PDF);
      expect(pdfElement.get('fileName')).toBe('Week 2.PDF');
      expect(Array.from(pdfElement.get('pdfData') as Uint8Array)).toEqual([
        4, 5, 6,
      ]);
    } finally {
      await session.close();
    }
  });
});
