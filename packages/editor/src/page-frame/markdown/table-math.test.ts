import type { Node as PMNode } from 'prosemirror-model';
import { describe, expect, it } from 'vitest';
import { schema } from '../pm/schema';
import { parseMarkdownToDoc } from './parser';
import { serializeDocToMarkdown } from './serializer';

// Mirrors the in-editor state after a user types inline math in a table cell: the doc holds raw
// LaTeX (e.g. `$e^{i\pi}$`) and the math-preview plugin renders it. Saving must not corrupt it.
function tableDoc(cellText: string): PMNode {
  return schema.nodes.doc.create(null, [
    schema.nodes.table.create(null, [
      schema.nodes.table_row.create(null, [
        schema.nodes.table_header.create(
          null,
          schema.nodes.paragraph.create(null, schema.text('h1')),
        ),
        schema.nodes.table_header.create(
          null,
          schema.nodes.paragraph.create(null, schema.text('h2')),
        ),
      ]),
      schema.nodes.table_row.create(null, [
        schema.nodes.table_cell.create(
          null,
          schema.nodes.paragraph.create(null, schema.text(cellText)),
        ),
        schema.nodes.table_cell.create(
          null,
          schema.nodes.paragraph.create(null, schema.text('z')),
        ),
      ]),
    ]),
  ]);
}

describe('markdown table inline-math serialization', () => {
  it('does not double-escape LaTeX backslashes in a table cell', () => {
    const md = serializeDocToMarkdown(tableDoc('$e^{i\\pi}$'));
    // The backslash must stay single — `\\pi` would corrupt the formula.
    expect(md).toContain('$e^{i\\pi}$');
    expect(md).not.toContain('\\\\pi');
  });

  it('escapes a pipe inside cell math so the row does not split', () => {
    const md = serializeDocToMarkdown(tableDoc('$a|b$'));
    // Pipe is escaped so re-parse keeps it inside the cell.
    expect(md).toContain('$a\\|b$');
    // Cell content stays in a single body row (header + divider + 1 body row).
    expect(md.trim().split('\n')).toHaveLength(3);

    // Round-trip: the escaped `\|` survives back into the cell as a literal `|`.
    const reparsed = parseMarkdownToDoc(md, schema);
    expect(reparsed.textContent).toContain('$a|b$');
  });

  it('escapes pipes in plain cell text without doubling backslashes', () => {
    // serializeInline already escaped the `*`; the cell path must only add the
    // pipe escape, not re-run markdown escaping (which would grow `\*`).
    const md = serializeDocToMarkdown(tableDoc('x * y | z'));
    expect(md).toContain('x \\* y \\| z');
    expect(md).not.toContain('\\\\');
  });

  it('round-trips cell math with its LaTeX backslashes intact', () => {
    const once = serializeDocToMarkdown(tableDoc('$e^{i\\pi}$'));
    expect(once).toContain('$e^{i\\pi}$');

    // `splitTableRow` only unescapes `\|`; other `\X` sequences (LaTeX backslashes) pass through to
    // parseInline, so re-parsing preserves the formula and the round-trip is stable.
    const reparsed = parseMarkdownToDoc(once, schema);
    expect(reparsed.textContent).toContain('$e^{i\\pi}$');
    expect(serializeDocToMarkdown(reparsed)).toBe(once);
  });

  it('keeps an escaped backslash before a cell boundary as a unit', () => {
    // Doc cell text `a\` serializes as `a\\`; on re-parse `\\` must be consumed as one escape so the
    // following `|` still splits the row instead of reading as an escaped pipe.
    const once = serializeDocToMarkdown(tableDoc('a\\'));
    const reparsed = parseMarkdownToDoc(once, schema);
    const cells: string[] = [];
    reparsed.descendants((node) => {
      if (node.type.name === 'table_cell') {
        cells.push(node.textContent);
      }
      return true;
    });
    expect(cells).toEqual(['a\\', 'z']);
    expect(serializeDocToMarkdown(reparsed)).toBe(once);
  });
});
