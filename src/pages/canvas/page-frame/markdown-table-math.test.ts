import type { Node as PMNode } from 'prosemirror-model';
import { describe, expect, it } from 'vitest';
import { parseMarkdownToDoc } from './markdown-parser';
import { serializeDocToMarkdown } from './markdown-serializer';
import { schema } from './pm/schema';

// Builds a single-cell table doc whose body cell contains the given text
// verbatim. This mirrors the in-editor state after a user types/edits inline
// math in a table cell: the doc holds the raw LaTeX (e.g. `$e^{i\pi}$`) and the
// math-preview plugin renders it. Serialization (save) must not corrupt it.
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

  it('serializes cell math without doubling, but re-parse drops the backslash (parser limitation)', () => {
    // The serializer now emits `$e^{i\pi}$` correctly (single backslash).
    const once = serializeDocToMarkdown(tableDoc('$e^{i\\pi}$'));
    expect(once).toContain('$e^{i\\pi}$');

    // Re-parsing is NOT yet a perfect round-trip: `splitTableRow` in
    // markdown-parser.ts unescapes every `\x` to `x` while splitting cells,
    // which strips LaTeX backslashes that are not pipe escapes. Fixing that
    // requires a math-aware parser change (out of scope here). This assertion
    // documents the current behavior so the limitation is visible.
    const twice = serializeDocToMarkdown(parseMarkdownToDoc(once, schema));
    expect(twice).toContain('$e^{ipi}$');
  });
});
