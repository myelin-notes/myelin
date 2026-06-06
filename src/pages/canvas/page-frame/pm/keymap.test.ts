import {
  EditorState,
  TextSelection,
  type Transaction,
} from 'prosemirror-state';
import { describe, expect, it } from 'vitest';
import { parseMarkdownToDoc } from '../markdown/parser';
import { serializeDocToMarkdown } from '../markdown/serializer';
import {
  calloutCaretAnchorCleanupPlugin,
  deleteBackwardInCallout,
  insertNewlineInCallout,
} from './keymap';
import { schema } from './schema';

function createStateAtBlockEnd(markdown: string): EditorState {
  const doc = parseMarkdownToDoc(markdown, schema);
  const block = doc.firstChild;
  if (!block) {
    throw new Error('Expected a first block');
  }
  const state = EditorState.create({ schema, doc });
  return state.apply(
    state.tr.setSelection(TextSelection.create(doc, 1 + block.content.size)),
  );
}

describe('insertNewlineInCallout', () => {
  it('extends a callout blockquote with an anchored newline', () => {
    const state = createStateAtBlockEnd('> [!info] Info\n> Body');
    let tr: Transaction | null = null;

    expect(
      insertNewlineInCallout(state, (nextTr) => {
        tr = nextTr;
      }),
    ).toBe(true);

    expect(tr).not.toBeNull();
    const nextState = state.apply(tr!);
    expect(nextState.doc.toJSON()).toEqual({
      type: 'doc',
      content: [
        {
          type: 'blockquote',
          content: [
            { type: 'text', text: '[!info] Info' },
            { type: 'hardBreak' },
            { type: 'text', text: 'Body\n ' },
          ],
        },
      ],
    });
    expect(serializeDocToMarkdown(nextState.doc)).toBe(
      '> [!info] Info\n> Body\n>\n',
    );
  });

  it('leaves regular blockquotes on the default Enter path', () => {
    const state = createStateAtBlockEnd('> regular quote');

    expect(insertNewlineInCallout(state)).toBe(false);
  });

  it('removes the caret anchor once the new callout line has content', () => {
    let state = EditorState.create({
      schema,
      doc: parseMarkdownToDoc('> [!info] Info\n> Body', schema),
      plugins: [calloutCaretAnchorCleanupPlugin()],
    });
    const block = state.doc.firstChild;
    if (!block) {
      throw new Error('Expected a first block');
    }
    state = state.apply(
      state.tr.setSelection(
        TextSelection.create(state.doc, 1 + block.content.size),
      ),
    );

    let tr: Transaction | null = null;
    insertNewlineInCallout(state, (nextTr) => {
      tr = nextTr;
    });
    state = state.applyTransaction(tr!).state;
    state = state.applyTransaction(state.tr.insertText('X')).state;

    expect(state.doc.toJSON()).toEqual({
      type: 'doc',
      content: [
        {
          type: 'blockquote',
          content: [
            { type: 'text', text: '[!info] Info' },
            { type: 'hardBreak' },
            { type: 'text', text: 'Body\nX' },
          ],
        },
      ],
    });
    expect(serializeDocToMarkdown(state.doc)).toBe(
      '> [!info] Info\n> Body\n> X\n',
    );
  });
});

describe('deleteBackwardInCallout', () => {
  it('deletes callout text through ProseMirror', () => {
    const state = createStateAtBlockEnd('> [!info] Info');
    let tr: Transaction | null = null;

    expect(
      deleteBackwardInCallout(state, (nextTr) => {
        tr = nextTr;
      }),
    ).toBe(true);

    expect(tr).not.toBeNull();
    const nextState = state.apply(tr!);
    expect(nextState.doc.textBetween(0, nextState.doc.content.size, '\n')).toBe(
      '[!info] Inf',
    );
  });

  it('anchors the caret after deleting the last character on a callout line', () => {
    const state = createStateAtBlockEnd('> [!info] Info\n> A');
    let tr: Transaction | null = null;

    expect(
      deleteBackwardInCallout(state, (nextTr) => {
        tr = nextTr;
      }),
    ).toBe(true);

    expect(tr).not.toBeNull();
    const nextState = state.apply(tr!);
    expect(nextState.doc.toJSON()).toEqual({
      type: 'doc',
      content: [
        {
          type: 'blockquote',
          content: [{ type: 'text', text: '[!info] Info\n ' }],
        },
      ],
    });
    expect(serializeDocToMarkdown(nextState.doc)).toBe('> [!info] Info\n>\n');
  });

  it('removes an anchored blank callout line on Backspace', () => {
    let state = createStateAtBlockEnd('> [!info] Info\n> A');
    let tr: Transaction | null = null;

    deleteBackwardInCallout(state, (nextTr) => {
      tr = nextTr;
    });
    state = state.apply(tr!);
    tr = null;

    expect(
      deleteBackwardInCallout(state, (nextTr) => {
        tr = nextTr;
      }),
    ).toBe(true);

    expect(tr).not.toBeNull();
    const nextState = state.apply(tr!);
    expect(nextState.doc.toJSON()).toEqual({
      type: 'doc',
      content: [
        {
          type: 'blockquote',
          content: [{ type: 'text', text: '[!info] Info' }],
        },
      ],
    });
  });

  it('removes the Backspace caret anchor once the blank line has content', () => {
    let state = EditorState.create({
      schema,
      doc: parseMarkdownToDoc('> [!info] Info\n> A', schema),
      plugins: [calloutCaretAnchorCleanupPlugin()],
    });
    const block = state.doc.firstChild;
    if (!block) {
      throw new Error('Expected a first block');
    }
    state = state.apply(
      state.tr.setSelection(
        TextSelection.create(state.doc, 1 + block.content.size),
      ),
    );

    let tr: Transaction | null = null;
    deleteBackwardInCallout(state, (nextTr) => {
      tr = nextTr;
    });
    state = state.applyTransaction(tr!).state;
    state = state.applyTransaction(state.tr.insertText('X')).state;

    expect(serializeDocToMarkdown(state.doc)).toBe('> [!info] Info\n> X\n');
  });

  it('leaves regular blockquotes on the default Backspace path', () => {
    const state = createStateAtBlockEnd('> regular quote');

    expect(deleteBackwardInCallout(state)).toBe(false);
  });
});
