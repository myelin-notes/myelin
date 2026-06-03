import { describe, expect, it } from 'vitest';
import { parseMarkdownToDoc } from './markdown-parser';
import { serializeDocToMarkdown } from './markdown-serializer';
import { schema } from './pm/schema';

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
});
