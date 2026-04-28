import { EditorState } from 'prosemirror-state';
import { describe, expect, it } from 'vitest';
import { parseMarkdownToDoc } from '../../markdown-parser';
import { schema } from '../schema';
import { buildMarkdownPasteTransaction, isBlockMarkdownPaste } from './paste';

describe('markdown paste', () => {
  it('recognizes block-level markdown paste', () => {
    expect(isBlockMarkdownPaste('# Heading')).toBe(true);
    expect(isBlockMarkdownPaste('- Item')).toBe(true);
    expect(isBlockMarkdownPaste('1. Item')).toBe(true);
    expect(
      isBlockMarkdownPaste(['```ts', 'const value = 1;', '```'].join('\n')),
    ).toBe(true);
    expect(
      isBlockMarkdownPaste(['| A | B |', '| --- | --- |'].join('\n')),
    ).toBe(true);
  });

  it('leaves inline-only markdown paste on the default paste path', () => {
    expect(isBlockMarkdownPaste('Plain **bold** and `code`.')).toBe(false);
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
