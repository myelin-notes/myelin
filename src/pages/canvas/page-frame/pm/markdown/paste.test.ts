import { EditorState } from 'prosemirror-state';
import { describe, expect, it } from 'vitest';
import { parseMarkdownToDoc } from '../../markdown-parser';
import { schema } from '../schema';
import {
  buildMarkdownPasteSlice,
  buildMarkdownPasteTransaction,
  hasParsedMarkdownBlock,
} from './paste';

describe('markdown paste', () => {
  it('uses the markdown parser output to decide when paste should handle blocks', () => {
    expect(
      hasParsedMarkdownBlock(parseMarkdownToDoc('# Heading', schema)),
    ).toBe(true);
    expect(hasParsedMarkdownBlock(parseMarkdownToDoc('- Item', schema))).toBe(
      true,
    );
    expect(hasParsedMarkdownBlock(parseMarkdownToDoc('1. Item', schema))).toBe(
      true,
    );
    expect(
      hasParsedMarkdownBlock(
        parseMarkdownToDoc(
          ['```ts', 'const value = 1;', '```'].join('\n'),
          schema,
        ),
      ),
    ).toBe(true);
    expect(
      hasParsedMarkdownBlock(
        parseMarkdownToDoc(['| A | B |', '| --- | --- |'].join('\n'), schema),
      ),
    ).toBe(true);
  });

  it('leaves inline-only markdown paste on the default paste path', () => {
    expect(buildMarkdownPasteSlice('Plain **bold** and `code`.', schema)).toBe(
      null,
    );
  });

  it('inserts parsed markdown blocks instead of plain paragraphs', () => {
    const state = EditorState.create({
      schema,
      doc: parseMarkdownToDoc('', schema),
    });
    const markdown = [
      '# Heading',
      '',
      '- **First**',
      '2. Second',
      '',
      '```ts',
      'const value = 1;',
      '```',
    ].join('\n');
    const tr = buildMarkdownPasteTransaction(state, markdown);

    expect(tr).not.toBeNull();
    expect(state.apply(tr!).doc.toJSON()).toEqual({
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: 'Heading' }],
        },
        {
          type: 'bulletListItem',
          attrs: { indent: 0 },
          content: [{ type: 'text', text: 'First', marks: [{ type: 'bold' }] }],
        },
        {
          type: 'orderedListItem',
          attrs: { order: 2, indent: 0 },
          content: [{ type: 'text', text: 'Second' }],
        },
        {
          type: 'codeBlock',
          content: [
            {
              type: 'text',
              text: ['```ts', 'const value = 1;', '```'].join('\n'),
            },
          ],
        },
      ],
    });
  });
});
