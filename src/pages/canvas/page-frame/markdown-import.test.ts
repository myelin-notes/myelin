import { describe, expect, it } from 'vitest';
import { yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror';
import { ElementType } from '../elements/element-type';
import { PAGE_HEIGHT, PAGE_WIDTH } from '../elements/page-frame-constants';
import { YDocManager } from '../ydoc-manager';
import {
  addMarkdownPageFrameToYDoc,
  DEFAULT_MARKDOWN_IMPORT_FRAME_OFFSET,
} from './markdown-import';
import { schema } from './pm/schema';

describe('markdown canvas import', () => {
  it('creates a page frame populated with parsed markdown', () => {
    const ydoc = new YDocManager();
    const index = addMarkdownPageFrameToYDoc(
      ydoc,
      ['# Imported Note', '', 'Hello **library** import.'].join('\n'),
    );

    expect(index).toBe(0);
    expect(ydoc.nextIndex).toBe(1);
    expect(ydoc.elements.length).toBe(1);

    const pageFrame = ydoc.elements.get(0);
    expect(pageFrame.get('type')).toBe(ElementType.PAGE_FRAME);
    expect(pageFrame.get('index')).toBe(0);
    expect(pageFrame.get('offsetX')).toBe(
      DEFAULT_MARKDOWN_IMPORT_FRAME_OFFSET.x,
    );
    expect(pageFrame.get('offsetY')).toBe(
      DEFAULT_MARKDOWN_IMPORT_FRAME_OFFSET.y,
    );
    expect(pageFrame.get('pageWidth')).toBe(PAGE_WIDTH);
    expect(pageFrame.get('pageHeight')).toBe(PAGE_HEIGHT);

    const doc = yXmlFragmentToProseMirrorRootNode(
      ydoc.getXmlFragment(index),
      schema,
    );
    expect(doc.textContent).toBe('Imported NoteHello library import.');
    expect(doc.toJSON().content?.[0]).toEqual({
      type: 'heading',
      attrs: { level: 1 },
      content: [{ type: 'text', text: 'Imported Note' }],
    });
  });
});
