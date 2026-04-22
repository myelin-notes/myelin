import { describe, expect, it } from 'vitest';
import { parseInlineMarkdown } from './parse-inline';

describe('parseInlineMarkdown', () => {
  it('parses triple-asterisk markup as overlapping bold and italic ranges', () => {
    expect(parseInlineMarkdown('***both***')).toEqual({
      ranges: [
        {
          kind: 'italic',
          open: { from: 0, to: 1 },
          contentFrom: 3,
          contentTo: 7,
          close: { from: 9, to: 10 },
        },
        {
          kind: 'bold',
          open: { from: 1, to: 3 },
          contentFrom: 3,
          contentTo: 7,
          close: { from: 7, to: 9 },
        },
      ],
    });
  });

  it('keeps bold italics, normal bold, and normal italics separate when they are side by side', () => {
    expect(parseInlineMarkdown('***both*** **bold** *italic*')).toEqual({
      ranges: [
        {
          kind: 'italic',
          open: { from: 0, to: 1 },
          contentFrom: 3,
          contentTo: 7,
          close: { from: 9, to: 10 },
        },
        {
          kind: 'bold',
          open: { from: 1, to: 3 },
          contentFrom: 3,
          contentTo: 7,
          close: { from: 7, to: 9 },
        },
        {
          kind: 'bold',
          open: { from: 11, to: 13 },
          contentFrom: 13,
          contentTo: 17,
          close: { from: 17, to: 19 },
        },
        {
          kind: 'italic',
          open: { from: 20, to: 21 },
          contentFrom: 21,
          contentTo: 27,
          close: { from: 27, to: 28 },
        },
      ],
    });
  });
});
