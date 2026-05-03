import { describe, expect, it } from 'vitest';
import {
  createDefaultPdfPageOrder,
  normalizePdfPageOrder,
} from './pdf-renderer';

describe('PDF page order metadata', () => {
  it('creates an entry for every page', () => {
    expect(createDefaultPdfPageOrder(3)).toEqual([
      { kind: 'pdf', originalIndex: 0 },
      { kind: 'pdf', originalIndex: 1 },
      { kind: 'pdf', originalIndex: 2 },
    ]);
  });

  it('expands a stale one-page placeholder when real metadata has more pages', () => {
    expect(
      normalizePdfPageOrder([{ kind: 'pdf', originalIndex: 0 }], 3),
    ).toEqual([
      { kind: 'pdf', originalIndex: 0 },
      { kind: 'pdf', originalIndex: 1 },
      { kind: 'pdf', originalIndex: 2 },
    ]);
  });

  it('keeps a complete explicit order', () => {
    expect(
      normalizePdfPageOrder(
        [
          { kind: 'pdf', originalIndex: 2 },
          { kind: 'pdf', originalIndex: 1 },
          { kind: 'pdf', originalIndex: 0 },
        ],
        3,
      ),
    ).toEqual([
      { kind: 'pdf', originalIndex: 2 },
      { kind: 'pdf', originalIndex: 1 },
      { kind: 'pdf', originalIndex: 0 },
    ]);
  });

  it('replaces duplicate entries with the complete default order', () => {
    expect(
      normalizePdfPageOrder(
        [
          { kind: 'pdf', originalIndex: 0 },
          { kind: 'pdf', originalIndex: 0 },
          { kind: 'pdf', originalIndex: 2 },
        ],
        3,
      ),
    ).toEqual([
      { kind: 'pdf', originalIndex: 0 },
      { kind: 'pdf', originalIndex: 1 },
      { kind: 'pdf', originalIndex: 2 },
    ]);
  });
});
