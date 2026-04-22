import { describe, expect, it } from 'vitest';
import {
  prosemirrorToYDoc,
  yXmlFragmentToProseMirrorRootNode,
} from 'y-prosemirror';
import { parseMarkdownToDoc } from './markdown-parser';
import { serializeDocToMarkdown } from './markdown-serializer';
import { schema } from './pm/schema';

describe('page-frame content shape', () => {
  it('imports headings, quotes, and list items as text blocks rather than atomic embeds', () => {
    const doc = parseMarkdownToDoc(
      [
        '### Heading',
        '',
        '> quoted line',
        '> continued',
        '',
        '    - nested bullet',
        '  3. ordered child',
        '',
        'plain paragraph',
        '',
        '---',
      ].join('\n'),
      schema,
    );

    const blocks: Array<{
      isTextblock: boolean;
      text: string;
      type: string;
    }> = [];
    doc.forEach((node) => {
      blocks.push({
        type: node.type.name,
        isTextblock: node.isTextblock,
        text: node.textContent,
      });
    });

    expect(blocks).toEqual([
      { type: 'heading', isTextblock: true, text: 'Heading' },
      { type: 'blockquote', isTextblock: true, text: 'quoted line continued' },
      { type: 'bulletListItem', isTextblock: true, text: 'nested bullet' },
      { type: 'orderedListItem', isTextblock: true, text: 'ordered child' },
      { type: 'paragraph', isTextblock: true, text: 'plain paragraph' },
      { type: 'horizontalRule', isTextblock: false, text: '' },
    ]);
  });

  it('preserves rich-text paragraphs through the Yjs-backed editor state', () => {
    const doc = parseMarkdownToDoc(
      'Hello **bold** [link](https://example.com) ![diagram](https://example.com/a.png) `inline`',
      schema,
    );
    const ydoc = prosemirrorToYDoc(doc, 'page-frame');
    const roundTripped = yXmlFragmentToProseMirrorRootNode(
      ydoc.getXmlFragment('page-frame'),
      schema,
    );
    const paragraph = roundTripped.firstChild;
    const paragraphJson = roundTripped.toJSON().content?.[0];
    const childTypes: string[] = [];

    paragraph?.forEach((child) => {
      childTypes.push(child.type.name);
    });

    expect(roundTripped.toJSON()).toEqual(doc.toJSON());
    expect(paragraph?.type.name).toBe('paragraph');
    expect(paragraph?.isTextblock).toBe(true);
    expect(childTypes).toContain('image');
    expect(paragraphJson).toEqual(
      expect.objectContaining({
        type: 'paragraph',
        content: expect.arrayContaining([
          { type: 'text', text: 'Hello ' },
          { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
          {
            type: 'text',
            text: 'link',
            marks: [
              {
                type: 'link',
                attrs: { href: 'https://example.com', title: null },
              },
            ],
          },
          {
            type: 'image',
            attrs: {
              alt: 'diagram',
              height: null,
              src: 'https://example.com/a.png',
              width: null,
            },
          },
          { type: 'text', text: 'inline', marks: [{ type: 'code' }] },
        ]),
      }),
    );
  });

  it('round-trips triple-asterisk bold italics through page-frame markdown', () => {
    const markdown = '***bold italics***';
    const doc = parseMarkdownToDoc(markdown, schema);
    const ydoc = prosemirrorToYDoc(doc, 'page-frame');
    const roundTripped = yXmlFragmentToProseMirrorRootNode(
      ydoc.getXmlFragment('page-frame'),
      schema,
    );

    expect(doc.toJSON()).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'bold italics',
              marks: [{ type: 'bold' }, { type: 'italic' }],
            },
          ],
        },
      ],
    });
    expect(roundTripped.toJSON()).toEqual(doc.toJSON());
    expect(serializeDocToMarkdown(roundTripped)).toBe(`${markdown}\n`);
  });

  it('keeps bold italics, normal bold, and normal italics distinct when they appear side by side', () => {
    const markdown = '***bold italics*** **normal bold** *normal italics*';
    const doc = parseMarkdownToDoc(markdown, schema);
    const ydoc = prosemirrorToYDoc(doc, 'page-frame');
    const roundTripped = yXmlFragmentToProseMirrorRootNode(
      ydoc.getXmlFragment('page-frame'),
      schema,
    );

    expect(doc.toJSON()).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'bold italics',
              marks: [{ type: 'bold' }, { type: 'italic' }],
            },
            { type: 'text', text: ' ' },
            {
              type: 'text',
              text: 'normal bold',
              marks: [{ type: 'bold' }],
            },
            { type: 'text', text: ' ' },
            {
              type: 'text',
              text: 'normal italics',
              marks: [{ type: 'italic' }],
            },
          ],
        },
      ],
    });
    expect(roundTripped.toJSON()).toEqual(doc.toJSON());
    expect(serializeDocToMarkdown(roundTripped)).toBe(`${markdown}\n`);
  });

  it('preserves fenced code blocks through the Yjs-backed editor state and markdown export', () => {
    const markdown = ['```ts', 'const answer = 42;', '```'].join('\n');
    const doc = parseMarkdownToDoc(markdown, schema);
    const ydoc = prosemirrorToYDoc(doc, 'page-frame');
    const roundTripped = yXmlFragmentToProseMirrorRootNode(
      ydoc.getXmlFragment('page-frame'),
      schema,
    );

    expect(doc.toJSON()).toEqual({
      type: 'doc',
      content: [
        {
          type: 'codeBlock',
          content: [{ type: 'text', text: markdown }],
        },
      ],
    });
    expect(roundTripped.toJSON()).toEqual(doc.toJSON());
    expect(serializeDocToMarkdown(roundTripped)).toBe(`${markdown}\n`);
  });
});
