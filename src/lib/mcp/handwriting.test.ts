import { describe, expect, it } from 'vitest';
import type {
  HandwritingCapability,
  RecognizedLine,
  RecognizedPage,
} from '@myelin/editor/platform/types';
import { readMcpHandwriting } from './handwriting';

function line(text: string, y: number): RecognizedLine {
  return {
    text,
    bbox: [10, y, 200, 40],
    strokeIds: [`s-${y}`],
    hash: `h-${y}`,
  };
}

function capability(page: RecognizedPage | null): HandwritingCapability {
  return {
    init: () => {},
    reset: () => {},
    requestRecognize: () => {},
    startBackfill: () => {},
    readPage: async () => page,
    removeRecognition: async () => {},
  };
}

function page(lines: RecognizedLine[]): RecognizedPage {
  return {
    nodeId: 'note-1',
    sourceHash: 'hash',
    schemaVersion: 1,
    lines,
    updatedAt: 1700000000000,
  };
}

describe('readMcpHandwriting', () => {
  it('reports recognized text with per-line bounds', async () => {
    const result = await readMcpHandwriting(
      capability(page([line('shopping list', 0), line('milk', 60)])),
      'note-1',
    );

    expect(result.status).toBe('recognized');
    expect(result.lineCount).toBe(2);
    expect(result.recognizedAt).toBe(1700000000000);
    expect(result.lines[0]).toEqual({
      text: 'shopping list',
      bounds: { x: 10, y: 0, width: 200, height: 40 },
      strokeIds: ['s-0'],
    });
  });

  // The non-Apple case: clustering still located the ink, OCR produced nothing.
  it('distinguishes located-but-unrecognized ink from absent ink', async () => {
    const result = await readMcpHandwriting(
      capability(page([line('', 0), line('   ', 60)])),
      'note-1',
    );

    expect(result.status).toBe('text-unavailable');
    expect(result.lineCount).toBe(2);
    // Geometry survives even with no text, so a screenshot can still be framed.
    expect(result.lines[1].bounds).toEqual({
      x: 10,
      y: 60,
      width: 200,
      height: 40,
    });
    expect(result.note).toMatch(/screenshot_canvas/);
  });

  it('keeps unrecognized lines alongside recognized ones', async () => {
    const result = await readMcpHandwriting(
      capability(page([line('', 0), line('legible', 60)])),
      'note-1',
    );

    expect(result.status).toBe('recognized');
    expect(result.lines.map((l) => l.text)).toEqual(['', 'legible']);
  });

  it('reports no artifact as not-recognized rather than empty handwriting', async () => {
    const result = await readMcpHandwriting(capability(null), 'note-1');

    expect(result.status).toBe('not-recognized');
    expect(result.lineCount).toBe(0);
    expect(result.recognizedAt).toBeNull();
    expect(result.note).toMatch(/screenshot_canvas/);
  });

  // An artifact with no lines is a real answer and must not read as "unknown".
  it('reports an artifact with no lines as definitively no handwriting', async () => {
    const result = await readMcpHandwriting(capability(page([])), 'note-1');

    expect(result.status).toBe('no-handwriting');
    expect(result.recognizedAt).toBe(1700000000000);
    expect(result.note).not.toMatch(/screenshot_canvas/);
  });

  it('handles a platform with no handwriting capability at all', async () => {
    const result = await readMcpHandwriting(undefined, 'note-1');

    expect(result.status).toBe('not-recognized');
    expect(result.lines).toEqual([]);
  });
});
