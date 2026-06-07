import { EditorState } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { describe, expect, it, vi } from 'vitest';
import { NOTE_LINK_OPEN_REQUEST_EVENT } from '@/lib/events';
import { parseMarkdownToDoc } from '../../markdown/parser';
import { serializeDocToMarkdown } from '../../markdown/serializer';
import { schema } from '../schema';
import {
  buildNormalizedNoteLinkTransaction,
  buildRenamePageFrameLinkReferencesTransaction,
  buildResolvedNoteLinkTransaction,
  normalizeAndResolveNoteLinksDoc,
  noteLinkMarkdownPlugin,
  renameNoteLinkReferencesDoc,
  renameNoteLinkReferenceTitle,
  renamePageFrameLinkReferencesDoc,
  renamePageFrameLinkReferenceTitle,
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
                  attrs: {
                    title: 'Alpha Note',
                    noteId: null,
                    pageFrameId: null,
                  },
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
                  attrs: {
                    title: 'Alpha Note Revised',
                    noteId: null,
                    pageFrameId: null,
                  },
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
      new Map([['Alpha Note', { noteId: 'note-1', pageFrameId: null }]]),
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
                  attrs: {
                    title: 'Alpha Note',
                    noteId: 'note-1',
                    pageFrameId: null,
                  },
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
      async () => ({ noteId: 'note-1', pageFrameId: null }),
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
                  attrs: {
                    title: 'Alpha Note',
                    noteId: 'note-1',
                    pageFrameId: null,
                  },
                },
              ],
            },
          ],
        },
      ],
    });
  });

  it('renames resolved note-link references while preserving frame', async () => {
    const doc = await normalizeAndResolveNoteLinksDoc(
      parseMarkdownToDoc(
        'See [[Projects/Alpha Note#Draft]] and [[Other]].',
        schema,
      ),
      schema,
      async (title) => ({
        noteId: title.startsWith('Projects/Alpha Note') ? 'note-1' : null,
        pageFrameId: null,
      }),
    );

    const result = renameNoteLinkReferencesDoc(
      doc,
      schema,
      'note-1',
      'Renamed Note',
    );

    expect(result.count).toBe(1);
    expect(serializeDocToMarkdown(result.doc)).toBe(
      'See [[Projects/Renamed Note#Draft]] and [[Other]].\n',
    );
  });

  it('renames the last path segment in note-link titles', () => {
    expect(renameNoteLinkReferenceTitle('Archive/Alpha#Research', 'Beta')).toBe(
      'Archive/Beta#Research',
    );
  });

  it('renames only the page-frame fragment in note-link titles', () => {
    expect(
      renamePageFrameLinkReferenceTitle('Archive/Alpha#Research', 'Findings'),
    ).toBe('Archive/Alpha#Findings');
  });

  it('leaves titles without a page-frame fragment unchanged', () => {
    expect(renamePageFrameLinkReferenceTitle('Archive/Alpha', 'Anything')).toBe(
      'Archive/Alpha',
    );
  });

  it('escapes hash in renamed note name', () => {
    expect(
      renameNoteLinkReferenceTitle('Archive/Alpha#Research', 'Plan #B'),
    ).toBe('Archive/Plan \\#B#Research');
  });

  it('escapes hash in renamed page-frame name', () => {
    expect(
      renamePageFrameLinkReferenceTitle(
        'Archive/Alpha#Research',
        'Plan #2 draft',
      ),
    ).toBe('Archive/Alpha#Plan \\#2 draft');
  });

  it('preserves escaped hash in note target when renaming the frame', () => {
    expect(renamePageFrameLinkReferenceTitle('Foo\\#Bar#Old', 'New')).toBe(
      'Foo\\#Bar#New',
    );
  });

  it('preserves resolved pageFrameId across normalization passes', () => {
    const noteLinkMark = schema.marks.noteLink;
    const title = 'Alpha Note#Frame';
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(null, [
        schema.text('[[Alpha Note#Frame]]', [
          noteLinkMark.create({
            title,
            noteId: 'note-1',
            pageFrameId: 'frame-1',
          }),
        ]),
      ]),
    ]);
    const state = createEditorState(doc);
    expect(buildNormalizedNoteLinkTransaction(state, schema)).toBeNull();
  });

  it('rewrites page-frame link titles in a doc when the frame is renamed', async () => {
    const doc = await normalizeAndResolveNoteLinksDoc(
      parseMarkdownToDoc(
        'See [[Alpha Note#Draft]] and [[Alpha Note#Final]].',
        schema,
      ),
      schema,
      async (title) => ({
        noteId: 'note-1',
        pageFrameId: title.endsWith('#Draft') ? 'frame-draft' : null,
      }),
    );

    const result = renamePageFrameLinkReferencesDoc(
      doc,
      schema,
      'frame-draft',
      'Outline',
    );

    expect(result.count).toBe(1);
    expect(serializeDocToMarkdown(result.doc)).toBe(
      'See [[Alpha Note#Outline]] and [[Alpha Note#Final]].\n',
    );
  });

  it('builds null transaction when no link references the renamed frame', () => {
    const noteLinkMark = schema.marks.noteLink;
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(null, [
        schema.text('[[Alpha Note#Other]]', [
          noteLinkMark.create({
            title: 'Alpha Note#Other',
            noteId: 'note-1',
            pageFrameId: 'frame-other',
          }),
        ]),
      ]),
    ]);
    const state = createEditorState(doc);

    expect(
      buildRenamePageFrameLinkReferencesTransaction(
        state,
        schema,
        'frame-missing',
        'New Name',
      ),
    ).toBeNull();
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
      pageFrameId: null,
    });
  });
});
