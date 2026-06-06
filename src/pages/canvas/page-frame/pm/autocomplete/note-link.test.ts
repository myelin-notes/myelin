import { EditorState, TextSelection } from 'prosemirror-state';
import { describe, expect, it } from 'vitest';
import { parseMarkdownToDoc } from '../../markdown/parser';
import { buildResolvedNoteLinkTransaction } from '../markdown/note-links';
import { schema } from '../schema';
import {
  buildSelectNoteLinkAutocompleteTransaction,
  findActiveNoteLinkAutocomplete,
} from './note-link';

function createState(markdown: string, head: number) {
  const state = EditorState.create({
    schema,
    doc: parseMarkdownToDoc(markdown, schema),
  });

  return state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, head)),
  );
}

describe('findActiveNoteLinkAutocomplete', () => {
  it('detects unfinished note-link titles at caret', () => {
    const markdown = 'See [[Al';
    const head = 1 + markdown.length;
    const openFrom = 1 + 'See '.length;
    const state = createState(markdown, head);

    expect(findActiveNoteLinkAutocomplete(state)).toEqual({
      query: 'Al',
      range: {
        from: openFrom + 2,
        to: head,
      },
      replaceRange: {
        from: openFrom,
        to: head,
      },
      anchorPosition: head,
    });
  });

  it('detects closed note-link titles while caret stays inside title', () => {
    const markdown = 'See [[Alpha Note]]';
    const openFrom = 1 + 'See '.length;
    const title = 'Alpha Note';
    const head = 1 + 'See [[Alpha'.length;
    const state = createState(markdown, head);

    expect(findActiveNoteLinkAutocomplete(state)).toEqual({
      query: title,
      range: {
        from: openFrom + 2,
        to: openFrom + 2 + title.length,
      },
      replaceRange: {
        from: openFrom,
        to: openFrom + 2 + title.length + 2,
      },
      anchorPosition: head,
    });
  });
});

describe('buildSelectNoteLinkAutocompleteTransaction', () => {
  it('inserts selected note link and keeps explicit note id', () => {
    const markdown = 'See [[Al';
    const head = 1 + markdown.length;
    const state = createState(markdown, head);
    const activeRequest = findActiveNoteLinkAutocomplete(state);

    expect(activeRequest).not.toBeNull();

    const tr = buildSelectNoteLinkAutocompleteTransaction(
      state,
      schema,
      activeRequest!,
      { id: 'note-2', title: 'Alpha Note' },
    );

    expect(tr).not.toBeNull();

    const selectedState = state.apply(tr!);

    expect(selectedState.doc.toJSON()).toEqual({
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
                  attrs: {
                    title: 'Alpha Note',
                    noteId: 'note-2',
                    pageFrameId: null,
                  },
                },
              ],
            },
          ],
        },
      ],
    });

    expect(
      buildResolvedNoteLinkTransaction(
        selectedState,
        schema,
        new Map([['Alpha Note', { noteId: 'note-1', pageFrameId: null }]]),
      ),
    ).toBeNull();
  });

  it('uses autocomplete insert text as the durable note-link target', () => {
    const markdown = 'See [[Projects/Al';
    const head = 1 + markdown.length;
    const state = createState(markdown, head);
    const activeRequest = findActiveNoteLinkAutocomplete(state);

    expect(activeRequest).not.toBeNull();

    const tr = buildSelectNoteLinkAutocompleteTransaction(
      state,
      schema,
      activeRequest!,
      {
        id: 'note-2',
        title: 'Alpha Note',
        insertText: 'Projects/Alpha Note',
      },
    );

    expect(tr).not.toBeNull();

    const selectedState = state.apply(tr!);

    expect(selectedState.doc.toJSON()).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'See ' },
            {
              type: 'text',
              text: '[[Projects/Alpha Note]]',
              marks: [
                {
                  type: 'noteLink',
                  attrs: {
                    title: 'Projects/Alpha Note',
                    noteId: 'note-2',
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
});
