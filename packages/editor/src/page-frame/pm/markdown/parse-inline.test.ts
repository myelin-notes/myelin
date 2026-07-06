import { describe, expect, it } from 'vitest';
import { parseInlineMarkdown } from './parse-inline';

describe('parseInlineMarkdown', () => {
  it('parses note-link markup as a distinct inline preview range', () => {
    expect(parseInlineMarkdown('[[note]]')).toEqual({
      ranges: [
        {
          kind: 'noteLink',
          open: { from: 0, to: 2 },
          contentFrom: 2,
          contentTo: 6,
          close: { from: 6, to: 8 },
        },
      ],
    });
  });

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

  it('keeps note links and normal italics separate when they are side by side', () => {
    expect(parseInlineMarkdown('[[note]] *italic*')).toEqual({
      ranges: [
        {
          kind: 'noteLink',
          open: { from: 0, to: 2 },
          contentFrom: 2,
          contentTo: 6,
          close: { from: 6, to: 8 },
        },
        {
          kind: 'italic',
          open: { from: 9, to: 10 },
          contentFrom: 10,
          contentTo: 16,
          close: { from: 16, to: 17 },
        },
      ],
    });
  });

  it('parses dollar-delimited math as an inline preview range', () => {
    expect(parseInlineMarkdown('$x^2$')).toEqual({
      ranges: [
        {
          kind: 'math',
          open: { from: 0, to: 1 },
          contentFrom: 1,
          contentTo: 4,
          close: { from: 4, to: 5 },
        },
      ],
    });
  });

  it('parses two separate math ranges side by side', () => {
    expect(parseInlineMarkdown('$a$ b $c$').ranges.map((r) => r.kind)).toEqual([
      'math',
      'math',
    ]);
  });

  it('does not treat currency amounts as math', () => {
    expect(parseInlineMarkdown('costs $100 and $200 total').ranges).toEqual([]);
  });

  it('matches the later candidate when an earlier dollar cannot close', () => {
    expect(parseInlineMarkdown('$a $b$')).toEqual({
      ranges: [
        {
          kind: 'math',
          open: { from: 3, to: 4 },
          contentFrom: 4,
          contentTo: 5,
          close: { from: 5, to: 6 },
        },
      ],
    });
  });

  it('ignores escaped dollar signs', () => {
    expect(parseInlineMarkdown('\\$5 and \\$10').ranges).toEqual([]);
  });

  it('does not parse math inside inline code', () => {
    expect(parseInlineMarkdown('`$x$`').ranges.map((r) => r.kind)).toEqual([
      'inlineCode',
    ]);
  });

  it('does not parse math inside note links', () => {
    expect(
      parseInlineMarkdown('[[a $b$ c]]').ranges.map((r) => r.kind),
    ).toEqual(['noteLink']);
  });

  it('does not pair dollars across a newline', () => {
    expect(parseInlineMarkdown('$a\nb$').ranges).toEqual([]);
  });

  it('does not treat double dollars as inline math', () => {
    expect(parseInlineMarkdown('a $$ b').ranges).toEqual([]);
    expect(parseInlineMarkdown('$$x$$').ranges).toEqual([]);
  });

  it('ignores an unclosed dollar', () => {
    expect(parseInlineMarkdown('paid $5').ranges).toEqual([]);
  });
});
