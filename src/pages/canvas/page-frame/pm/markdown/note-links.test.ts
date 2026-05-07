import { EditorState } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { describe, expect, it, vi } from 'vitest';
import { NOTE_LINK_OPEN_REQUEST_EVENT } from '@/lib/events';
import { parseMarkdownToDoc } from '../../markdown-parser';
import { serializeDocToMarkdown } from '../../markdown-serializer';
import { schema } from '../schema';
import {
  buildNormalizedNoteLinkTransaction,
  buildResolvedNoteLinkTransaction,
  normalizeAndResolveNoteLinksDoc,
  noteLinkMarkdownPlugin,
  renameNoteLinkReferencesDoc,
  renameNoteLinkReferenceTitle,
} from './note-links';

function createEditorState(doc = schema.nodes.doc.createAndFill()!) {
  return EditorState.create({
    schema,
    doc,
    plugins: [noteLinkMarkdownPlugin(schema)],
  });
}

describe('noteLinkMarkdownPlugin', () => {
  it('adds note-link metadata when raw note-link markdown is typed', () => {
    const state = createEditorState();
    const result = state.applyTransaction(
      state.tr.insertText('[[Alpha Note]]', 1),
    );

    expect(result.state.doc.toJSON()).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: '[[Alpha Note]]',
              marks: [
                {
                  type: 'noteLink',
                  attrs: { title: 'Alpha Note', noteId: null },
                },
              ],
            },
          ],
        },
      ],
    });
  });

  it('updates note-link title metadata when typed title changes', () => {
    const state = createEditorState(
      parseMarkdownToDoc('[[Alpha Note]]', schema),
    );
    const result = state.applyTransaction(state.tr.insertText(' Revised', 13));

    expect(result.state.doc.toJSON()).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: '[[Alpha Note Revised]]',
              marks: [
                {
                  type: 'noteLink',
                  attrs: { title: 'Alpha Note Revised', noteId: null },
                },
              ],
            },
          ],
        },
      ],
    });
  });

  it('updates note ids from resolved title matches', () => {
    const state = createEditorState(
      parseMarkdownToDoc('[[Alpha Note]]', schema),
    );
    const tr = buildResolvedNoteLinkTransaction(
      state,
      schema,
      new Map([['Alpha Note', 'note-1']]),
    );

    expect(tr).not.toBeNull();
    expect(state.apply(tr!).doc.toJSON()).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
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
          ],
        },
      ],
    });
  });

  it('preserves distinct autocomplete-selected note ids for identical link text', () => {
    const noteLinkMark = schema.marks.noteLink;
    const title = 'Projects/Alpha Note';
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(null, [
        schema.text('[[Projects/Alpha Note]]', [
          noteLinkMark.create({ title, noteId: 'note-1' }),
        ]),
        schema.text(' and '),
        schema.text('[[Projects/Alpha Note]]', [
          noteLinkMark.create({ title, noteId: 'note-2' }),
        ]),
      ]),
    ]);
    const state = createEditorState(doc);

    expect(buildNormalizedNoteLinkTransaction(state, schema)).toBeNull();
  });

  it('normalizes and resolves imported note links through shared helper', async () => {
    const doc = await normalizeAndResolveNoteLinksDoc(
      parseMarkdownToDoc('[[Alpha Note]]', schema),
      schema,
      async () => 'note-1',
    );

    expect(doc.toJSON()).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
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
          ],
        },
      ],
    });
  });

  it('renames resolved note-link references while preserving suffixes', async () => {
    const doc = await normalizeAndResolveNoteLinksDoc(
      parseMarkdownToDoc(
        'See [[Projects/Alpha Note#Draft|alias]] and [[Other]].',
        schema,
      ),
      schema,
      async (title) =>
        title.startsWith('Projects/Alpha Note') ? 'note-1' : null,
    );

    const result = renameNoteLinkReferencesDoc(
      doc,
      schema,
      'note-1',
      'Renamed Note',
    );

    expect(result.count).toBe(1);
    expect(serializeDocToMarkdown(result.doc)).toBe(
      'See [[Projects/Renamed Note#Draft|alias]] and [[Other]].\n',
    );
  });

  it('renames the last path segment in note-link titles', () => {
    expect(
      renameNoteLinkReferenceTitle('Archive/Alpha#Research|display', 'Beta'),
    ).toBe('Archive/Beta#Research|display');
  });

  it('requests navigation to the note link on cmd-click', () => {
    const plugin = noteLinkMarkdownPlugin(schema);
    const handleClick = plugin.props.handleClick;
    const dispatchedEvents: CustomEvent[] = [];
    const view = {
      dom: {
        dispatchEvent: vi.fn((event: Event) => {
          dispatchedEvents.push(event as CustomEvent);
          return true;
        }),
      },
    } as unknown as EditorView;
    const target = {
      closest(selector: string) {
        return selector === '[data-note-link-title]' ? this : null;
      },
      getAttribute(name: string) {
        if (name === 'data-note-link-title') {
          return 'Alpha Note';
        }
        return name === 'data-note-id' ? 'note-1' : null;
      },
    };
    const preventDefault = vi.fn();
    const event = {
      metaKey: true,
      ctrlKey: false,
      target,
      preventDefault,
    } as unknown as MouseEvent;

    expect(handleClick?.call(plugin, view, 1, event)).toBe(true);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(view.dom.dispatchEvent).toHaveBeenCalledOnce();
    expect(dispatchedEvents[0]?.type).toBe(NOTE_LINK_OPEN_REQUEST_EVENT);
    expect(dispatchedEvents[0]?.detail).toEqual({
      title: 'Alpha Note',
      noteId: 'note-1',
    });
  });
});
