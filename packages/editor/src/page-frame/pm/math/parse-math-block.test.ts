import { describe, expect, it } from 'vitest';
import {
  isMathFenceLine,
  parseMathMarkdown,
  SINGLE_LINE_MATH_BLOCK_RE,
  stripMathDelimiters,
} from './parse-math-block';

describe('parseMathMarkdown', () => {
  it('parses a fenced math block', () => {
    const parsed = parseMathMarkdown('$$\n\\frac{a}{b}\n$$');
    expect(parsed.hasOpeningFence).toBe(true);
    expect(parsed.hasClosingFence).toBe(true);
    expect(parsed.lines.map((line) => line.kind)).toEqual([
      'openingFence',
      'content',
      'closingFence',
    ]);
  });

  it('reports a missing closing fence', () => {
    const parsed = parseMathMarkdown('$$\nx');
    expect(parsed.hasOpeningFence).toBe(true);
    expect(parsed.hasClosingFence).toBe(false);
    expect(parsed.closingFence).toBeNull();
  });

  it('reports a missing opening fence', () => {
    const parsed = parseMathMarkdown('x\n$$');
    expect(parsed.hasOpeningFence).toBe(false);
    expect(parsed.hasClosingFence).toBe(false);
  });

  it('treats lines after the closing fence as content', () => {
    const parsed = parseMathMarkdown('$$\nx\n$$\ny');
    expect(parsed.lines.map((line) => line.kind)).toEqual([
      'openingFence',
      'content',
      'closingFence',
      'content',
    ]);
  });
});

describe('stripMathDelimiters', () => {
  it('returns the latex between the fences', () => {
    expect(stripMathDelimiters('$$\n\\frac{a}{b}\nx\n$$')).toBe(
      '\\frac{a}{b}\nx',
    );
  });

  it('returns the raw text when there is no opening fence', () => {
    expect(stripMathDelimiters('x + y')).toBe('x + y');
  });
});

describe('math fence helpers', () => {
  it('only accepts a bare $$ line as a fence', () => {
    expect(isMathFenceLine('$$')).toBe(true);
    expect(isMathFenceLine('$$x')).toBe(false);
    expect(isMathFenceLine(' $$')).toBe(false);
  });

  it('matches single-line block math with content', () => {
    expect(SINGLE_LINE_MATH_BLOCK_RE.test('$$x^2$$')).toBe(true);
    expect(SINGLE_LINE_MATH_BLOCK_RE.test('$$$$')).toBe(false);
  });
});
