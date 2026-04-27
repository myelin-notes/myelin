import { EditorState, NodeSelection } from 'prosemirror-state';
import { describe, expect, it } from 'vitest';
import { parseMarkdownToDoc } from '../../markdown-parser';
import { schema } from '../schema';
import {
  buildResolvedNoteEmbedTransaction,
  embedMarkdownPlugin,
  expandMarkdownEmbedCommand,
} from './embed-blocks';

function createEditorState(doc = schema.nodes.doc.createAndFill()!) {
  return EditorState.create({
    schema,
    doc,
    plugins: [embedMarkdownPlugin(schema)],
  });
}

describe('embedMarkdownPlugin', () => {
  it('normalizes standalone raw note embeds into note-embed nodes', () => {
    const state = createEditorState();
    const result = state.applyTransaction(
      state.tr.insertText('![[Alpha Note]]', 1),
    );

    expect(result.state.doc.toJSON()).toEqual({
      type: 'doc',
      content: [
        {
          type: 'noteEmbed',
          attrs: {
            target: 'Alpha Note',
            title: 'Alpha Note',
            fragment: null,
            noteId: null,
            width: null,
            height: null,
          },
        },
        {
          type: 'paragraph',
        },
      ],
    });
    expect(result.state.selection.from).toBe(2);
    expect(result.state.selection.to).toBe(2);
  });

  it('normalizes standalone raw external media embeds into media-embed nodes', () => {
    const state = createEditorState();
    const result = state.applyTransaction(
      state.tr.insertText('![Diagram|320](https://example.com/diagram.png)', 1),
    );

    expect(result.state.doc.toJSON()).toEqual({
      type: 'doc',
      content: [
        {
          type: 'mediaEmbed',
          attrs: {
            src: 'https://example.com/diagram.png',
            alt: 'Diagram',
            title: null,
            kind: 'image',
            width: 320,
            height: null,
          },
        },
        {
          type: 'paragraph',
        },
      ],
    });
    expect(result.state.selection.from).toBe(2);
    expect(result.state.selection.to).toBe(2);
  });

  it('leaves unsupported vault attachment embeds as raw markdown', () => {
    const state = createEditorState();
    const result = state.applyTransaction(
      state.tr.insertText('![[photo.jpg]]', 1),
    );

    expect(result.state.doc.toJSON()).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: '![[photo.jpg]]' }],
        },
      ],
    });
  });

  it('updates note-embed node ids from resolved title matches', () => {
    const state = createEditorState(
      parseMarkdownToDoc('![[Alpha Note]]', schema),
    );
    const tr = buildResolvedNoteEmbedTransaction(
      state,
      schema,
      new Map([['Alpha Note', 'note-1']]),
    );

    expect(tr).not.toBeNull();
    expect(state.apply(tr!).doc.toJSON()).toEqual({
      type: 'doc',
      content: [
        {
          type: 'noteEmbed',
          attrs: {
            target: 'Alpha Note',
            title: 'Alpha Note',
            fragment: null,
            noteId: 'note-1',
            width: null,
            height: null,
          },
        },
      ],
    });
  });
});

describe('expandMarkdownEmbedCommand', () => {
  it('turns a selected note embed back into raw markdown and places the caret inside the target', () => {
    const doc = parseMarkdownToDoc('![[Alpha Note]]', schema);
    const baseState = EditorState.create({ schema, doc });
    const state = baseState.apply(
      baseState.tr.setSelection(NodeSelection.create(baseState.doc, 0)),
    );
    let nextState = state;

    const handled = expandMarkdownEmbedCommand(state, (tr) => {
      nextState = state.apply(tr);
    });

    expect(handled).toBe(true);
    expect(nextState.doc.toJSON()).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: '![[Alpha Note]]' }],
        },
      ],
    });
    expect(nextState.selection.from).toBe(4);
    expect(nextState.selection.to).toBe(4);
  });

  it('turns a selected media embed back into raw markdown and places the caret inside the url', () => {
    const doc = parseMarkdownToDoc(
      '![Diagram|320](https://example.com/diagram.png)',
      schema,
    );
    const baseState = EditorState.create({ schema, doc });
    const state = baseState.apply(
      baseState.tr.setSelection(NodeSelection.create(baseState.doc, 0)),
    );
    let nextState = state;

    const handled = expandMarkdownEmbedCommand(state, (tr) => {
      nextState = state.apply(tr);
    });

    expect(handled).toBe(true);
    expect(nextState.doc.toJSON()).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: '![Diagram|320](https://example.com/diagram.png)',
            },
          ],
        },
      ],
    });
    expect(nextState.selection.from).toBe(16);
    expect(nextState.selection.to).toBe(16);
  });
});
