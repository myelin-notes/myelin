import { describe, expect, it } from 'vitest';
import {
  prosemirrorToYXmlFragment,
  yXmlFragmentToProseMirrorRootNode,
} from 'y-prosemirror';
import * as Y from 'yjs';
import { schema } from '../pm/schema';
import { writeMarkdownToPageFrameFragment } from './import';
import { parseMarkdownToDoc } from './parser';
import { serializeDocToMarkdown } from './serializer';

describe('document structure markdown', () => {
  it('round-trips a captioned figure, including quotes in the caption', () => {
    const markdown =
      '![plot](/My Pics/fig 1.png "Yield of \\"A\\" over time")\n';

    const doc = parseMarkdownToDoc(markdown, schema);

    expect(doc.child(0).type.name).toBe('figure');
    expect(doc.child(0).attrs.src).toBe('/My Pics/fig 1.png');
    expect(doc.child(0).textContent).toBe('Yield of "A" over time');
    expect(serializeDocToMarkdown(doc)).toBe(markdown);
  });

  it('round-trips a manual page break', () => {
    const markdown = 'Title\n\n<!-- pagebreak -->\n\nBody\n';

    const doc = parseMarkdownToDoc(markdown, schema);

    expect(doc.child(1).type.name).toBe('pageBreak');
    expect(serializeDocToMarkdown(doc)).toBe(markdown);
  });

  it('leaves an image with surrounding text as paragraph text', () => {
    const doc = parseMarkdownToDoc('see ![a](/b.png) here\n', schema);

    expect(doc.child(0).type.name).toBe('paragraph');
  });
});

describe('writeMarkdownToPageFrameFragment over existing content', () => {
  function styledFrame() {
    const fragment = new Y.Doc().getXmlFragment('frame');
    const red = schema.marks.textColor.create({ color: '#f00' });
    prosemirrorToYXmlFragment(
      schema.nodes.doc.create(null, [
        schema.nodes.paragraph.create(null, schema.text('keep me', [red])),
        schema.nodes.figure.create({ src: '/a.png', width: 0.4 }),
        schema.nodes.paragraph.create(null, schema.text('old typo')),
      ]),
      fragment,
    );
    return fragment;
  }

  it('keeps styling on blocks the markdown left unchanged', async () => {
    const fragment = styledFrame();

    await writeMarkdownToPageFrameFragment(
      'keep me\n\n![](/a.png)\n\nfixed typo\n',
      fragment,
    );

    const doc = yXmlFragmentToProseMirrorRootNode(fragment, schema);
    expect(doc.child(0).child(0).marks[0].type.name).toBe('textColor');
    expect(doc.child(1).attrs.width).toBe(0.4);
    expect(doc.child(2).textContent).toBe('fixed typo');
  });

  it('removes blocks the markdown dropped', async () => {
    const fragment = styledFrame();

    await writeMarkdownToPageFrameFragment('keep me\n', fragment);

    const doc = yXmlFragmentToProseMirrorRootNode(fragment, schema);
    expect(doc.childCount).toBe(1);
  });
});
