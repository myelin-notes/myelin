import { describe, expect, it } from 'vitest';
import { yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror';
import type { Repository } from '@/lib/sync';
import { ElementType } from '../elements/element-type';
import {
  DEFAULT_PAGE_FRAME_DISPLAY_NAME,
  PAGE_HEIGHT,
  PAGE_WIDTH,
} from '../elements/page-frame-constants';
import { YDocManager } from '../ydoc-manager';
import {
  addMarkdownPageFrameToYDoc,
  DEFAULT_MARKDOWN_IMPORT_FRAME_OFFSET,
} from './markdown-import';
import { schema } from './pm/schema';

describe('markdown canvas import', () => {
  it('creates a page frame populated with parsed markdown', async () => {
    const ydoc = new YDocManager();
    const uuid = await addMarkdownPageFrameToYDoc(
      ydoc,
      ['# Imported Note', '', 'Hello **library** import.'].join('\n'),
    );

    expect(typeof uuid).toBe('string');
    expect(uuid.length).toBeGreaterThan(0);
    expect(ydoc.elements.length).toBe(1);

    const pageFrame = ydoc.elements.get(0);
    expect(pageFrame.get('type')).toBe(ElementType.PAGE_FRAME);
    expect(pageFrame.get('uuid')).toBe(uuid);
    expect(pageFrame.get('displayName')).toBe(DEFAULT_PAGE_FRAME_DISPLAY_NAME);
    expect(pageFrame.get('offsetX')).toBe(
      DEFAULT_MARKDOWN_IMPORT_FRAME_OFFSET.x,
    );
    expect(pageFrame.get('offsetY')).toBe(
      DEFAULT_MARKDOWN_IMPORT_FRAME_OFFSET.y,
    );
    expect(pageFrame.get('pageWidth')).toBe(PAGE_WIDTH);
    expect(pageFrame.get('pageHeight')).toBe(PAGE_HEIGHT);

    const doc = yXmlFragmentToProseMirrorRootNode(
      ydoc.getXmlFragment(uuid),
      schema,
    );
    expect(doc.textContent).toBe('Imported NoteHello library import.');
    expect(doc.toJSON().content?.[0]).toEqual({
      type: 'heading',
      attrs: { level: 1 },
      content: [{ type: 'text', text: 'Imported Note' }],
    });
  });

  it('stores a custom page-frame display name when provided', async () => {
    const ydoc = new YDocManager();
    const uuid = await addMarkdownPageFrameToYDoc(ydoc, 'Body', {
      displayName: '  Literature Review  ',
    });

    expect(typeof uuid).toBe('string');
    expect(ydoc.elements.get(0).get('displayName')).toBe('Literature Review');
  });

  it('resolves note links by title and keeps missing note ids null', async () => {
    const ydoc = new YDocManager();
    const repository = {
      searchNodes: async (query: string) => {
        if (query === 'Alpha Note') {
          return [
            {
              id: 'note-1',
              name: 'Alpha Note',
              type: 'file',
              fileType: 'mcanvas',
              parentId: null,
              tags: [],
              createdAt: 0,
              modifiedAt: 0,
            },
            {
              id: 'note-2',
              name: 'Alpha Note',
              type: 'file',
              fileType: 'mcanvas',
              parentId: null,
              tags: [],
              createdAt: 0,
              modifiedAt: 0,
            },
          ];
        }
        return [];
      },
      getFolderChain: async () => [],
    } satisfies Pick<Repository, 'searchNodes' | 'getFolderChain'>;

    const uuid = await addMarkdownPageFrameToYDoc(
      ydoc,
      'See [[Alpha Note]] and [[Missing Note]].',
      { repository },
    );
    const doc = yXmlFragmentToProseMirrorRootNode(
      ydoc.getXmlFragment(uuid),
      schema,
    );

    expect(doc.toJSON()).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'See ' },
            {
              type: 'text',
              text: '[[Alpha Note]]',
              marks: [
                {
                  type: 'noteLink',
                  attrs: { title: 'Alpha Note', noteId: 'note-1' },
                },
              ],
            },
            { type: 'text', text: ' and ' },
            {
              type: 'text',
              text: '[[Missing Note]]',
              marks: [
                {
                  type: 'noteLink',
                  attrs: { title: 'Missing Note', noteId: null },
                },
              ],
            },
            { type: 'text', text: '.' },
          ],
        },
      ],
    });
  });
});
