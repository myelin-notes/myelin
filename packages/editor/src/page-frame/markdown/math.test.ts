import type { Node as PMNode } from 'prosemirror-model';
import { describe, expect, it } from 'vitest';
import { parseInlineMarkdown } from '../pm/markdown/parse-inline';
import { schema } from '../pm/schema';
import { parseMarkdownToDoc } from './parser';
import { serializeDocToMarkdown } from './serializer';

describe('markdown math round-trip', () => {
  it('parses a $$ fenced block into a mathBlock node', () => {
    const doc = parseMarkdownToDoc('$$\n\\frac{a}{b}\n$$', schema);
    expect(doc.toJSON()).toEqual({
      type: 'doc',
      content: [
        {
          type: 'mathBlock',
          content: [{ type: 'text', text: '$$\n\\frac{a}{b}\n$$' }],
        },
      ],
    });
  });

  it('canonicalizes single-line block math into the fenced form', () => {
    const doc = parseMarkdownToDoc('$$x^2$$', schema);
    expect(doc.firstChild?.type.name).toBe('mathBlock');
    expect(doc.firstChild?.textContent).toBe('$$\nx^2\n$$');
  });

  it('closes an unterminated $$ fence at the end of input', () => {
    const doc = parseMarkdownToDoc('$$\nx', schema);
    expect(doc.firstChild?.type.name).toBe('mathBlock');
    expect(doc.firstChild?.textContent).toBe('$$\nx\n$$');
  });

  it('round-trips multi-line block math', () => {
    const md = '$$\n\\begin{aligned}\na &= b \\\\\n&= c\n\\end{aligned}\n$$';
    const doc = parseMarkdownToDoc(md, schema);
    expect(serializeDocToMarkdown(doc)).toBe(`${md}\n`);
  });

  it('stops a paragraph at a $$ fence line', () => {
    const doc = parseMarkdownToDoc('text\n$$\nx\n$$', schema);
    expect(doc.childCount).toBe(2);
    expect(doc.child(0).type.name).toBe('paragraph');
    expect(doc.child(1).type.name).toBe('mathBlock');
  });

  it('preserves backslashes in inline math when serializing', () => {
    const doc = parseMarkdownToDoc('Euler: $e^{i\\pi} = -1$ holds', schema);
    expect(serializeDocToMarkdown(doc)).toBe('Euler: $e^{i\\pi} = -1$ holds\n');
  });

  it('still escapes markdown characters outside inline math', () => {
    const doc = parseMarkdownToDoc('a \\* b and $x \\cdot y$', schema);
    expect(doc.textContent).toBe('a * b and $x \\cdot y$');
    expect(serializeDocToMarkdown(doc)).toBe('a \\* b and $x \\cdot y$\n');
  });

  it('round-trips inline math next to currency text', () => {
    const md = 'costs $100 and $x^2$ total';
    const doc = parseMarkdownToDoc(md, schema);
    expect(serializeDocToMarkdown(doc)).toBe(`${md}\n`);
  });

  it('gives an inline code span precedence over a math candidate', () => {
    // `$a `b` c$` — the backtick code span wins, so the `$...$` is NOT math.
    const md = 'x $a `b` c$ y';
    const doc = parseMarkdownToDoc(md, schema);
    // The doc must contain a code mark for "b" (not literal math text).
    let hasCode = false;
    doc.descendants((node) => {
      if (node.isText && node.marks.some((m) => m.type.name === 'code')) {
        hasCode = true;
      }
    });
    expect(hasCode).toBe(true);
    // And the round-trip must be stable (no backtick escaping).
    expect(serializeDocToMarkdown(doc)).toBe(`${md}\n`);
  });

  it('keeps escaped dollars out of live math (\\$a\\$ is not math)', () => {
    // The escape is honored: the doc text keeps the backslashes so the
    // live-preview parser does not treat `$a$` as math.
    const doc = parseMarkdownToDoc('\\$a\\$', schema);
    expect(doc.textContent).toBe('\\$a\\$');
    expect(
      parseInlineMarkdown(doc.textContent).ranges.some(
        (range) => range.kind === 'math',
      ),
    ).toBe(false);
  });

  it('reaches a stable fixed point for escaped dollars across saves', () => {
    // The serializer doubles backslashes (`\` -> `\\`) and cannot emit a bare
    // `\$`, so the literal text drifts once on first save. What must hold is
    // that further saves are stable AND the dollars never become live math.
    for (const md of ['\\$a\\$', '\\$5']) {
      const once = serializeDocToMarkdown(parseMarkdownToDoc(md, schema));
      const twice = serializeDocToMarkdown(parseMarkdownToDoc(once, schema));
      const thrice = serializeDocToMarkdown(parseMarkdownToDoc(twice, schema));
      expect(twice).toBe(once);
      expect(thrice).toBe(once);
      expect(
        parseInlineMarkdown(
          parseMarkdownToDoc(once, schema).textContent,
        ).ranges.some((range) => range.kind === 'math'),
      ).toBe(false);
    }
  });
});

describe('markdown strikethrough escaping round-trip', () => {
  it('escapes literal ~~ so it does not re-parse as a strikethrough mark', () => {
    // A user typing literal `~~foo~~` (e.g. pasted prose/code) must not turn
    // into a strikethrough on the next import.
    const doc = parseMarkdownToDoc('a \\~\\~foo\\~\\~ b', schema);
    expect(doc.textContent).toBe('a ~~foo~~ b');
    const noStrike = !markNames(doc).includes('strikethrough');
    expect(noStrike).toBe(true);

    const md = serializeDocToMarkdown(doc);
    expect(md).toBe('a \\~\\~foo\\~\\~ b\n');

    // Round-trip stays literal: no strikethrough mark reintroduced.
    const reparsed = parseMarkdownToDoc(md, schema);
    expect(reparsed.textContent).toBe('a ~~foo~~ b');
    expect(markNames(reparsed)).not.toContain('strikethrough');
    expect(serializeDocToMarkdown(reparsed)).toBe(md);
  });

  it('still serializes a real strikethrough mark as ~~...~~', () => {
    const doc = parseMarkdownToDoc('a ~~struck~~ b', schema);
    expect(markNames(doc)).toContain('strikethrough');
    const md = serializeDocToMarkdown(doc);
    expect(md).toBe('a ~~struck~~ b\n');
    // And it round-trips back into a strikethrough mark.
    const reparsed = parseMarkdownToDoc(md, schema);
    expect(markNames(reparsed)).toContain('strikethrough');
    expect(serializeDocToMarkdown(reparsed)).toBe(md);
  });
});

function markNames(doc: PMNode): string[] {
  const names: string[] = [];
  doc.descendants((node) => {
    for (const mark of node.marks) {
      names.push(mark.type.name);
    }
    return true;
  });
  return names;
}
