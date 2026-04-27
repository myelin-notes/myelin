import { EditorState, TextSelection } from 'prosemirror-state';
import { describe, expect, it } from 'vitest';
import { parseMarkdownToDoc } from '../markdown-parser';
import type { PageFrameAutocompleteItem } from './autocomplete';
import { schema } from './schema';
import {
  buildSelectSlashInsertAutocompleteTransaction,
  findActiveSlashInsertAutocomplete,
  searchSlashInsertAutocompleteItems,
} from './slash-insert-autocomplete';

function createState(markdown: string, head: number) {
  const state = EditorState.create({
    schema,
    doc: parseMarkdownToDoc(markdown, schema),
  });

  return state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, head)),
  );
}

function findItem(id: string): PageFrameAutocompleteItem {
  const item = searchSlashInsertAutocompleteItems('', 20).find(
    (entry) => entry.id === id,
  );
  if (!item) {
    throw new Error(`Missing slash item: ${id}`);
  }
  return item;
}

describe('findActiveSlashInsertAutocomplete', () => {
  it('detects slash commands at the start of a block', () => {
    const markdown = '/head';
    const head = 1 + markdown.length;
    const state = createState(markdown, head);

    expect(findActiveSlashInsertAutocomplete(state)).toEqual({
      query: 'head',
      range: {
        from: 2,
        to: head,
      },
      replaceRange: {
        from: 1,
        to: head,
      },
      anchorPosition: head,
    });
  });

  it('does not trigger when the slash is not the first character', () => {
    const markdown = 'Alpha /head';
    const head = 1 + markdown.length;
    const state = createState(markdown, head);

    expect(findActiveSlashInsertAutocomplete(state)).toBeNull();
  });
});

describe('searchSlashInsertAutocompleteItems', () => {
  it('matches aliases like h2, links, and inline code', () => {
    expect(searchSlashInsertAutocompleteItems('h2', 5)[0]?.id).toBe(
      'slash-heading-2',
    );
    expect(searchSlashInsertAutocompleteItems('hyperlink', 5)[0]?.id).toBe(
      'slash-link',
    );
    expect(searchSlashInsertAutocompleteItems('table', 5)[0]?.id).toBe(
      'slash-table',
    );
    expect(searchSlashInsertAutocompleteItems('code', 5)[0]?.id).toBe(
      'slash-inline-code',
    );
  });
});

describe('buildSelectSlashInsertAutocompleteTransaction', () => {
  it('turns the current block into a heading and clears the slash command', () => {
    const markdown = '/heading';
    const head = 1 + markdown.length;
    const state = createState(markdown, head);
    const activeRequest = findActiveSlashInsertAutocomplete(state);

    expect(activeRequest).not.toBeNull();

    const tr = buildSelectSlashInsertAutocompleteTransaction(
      state,
      schema,
      activeRequest!,
      findItem('slash-heading-1'),
    );

    expect(tr).not.toBeNull();

    const selectedState = state.apply(tr!);

    expect(selectedState.doc.toJSON()).toEqual({
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
        },
      ],
    });
    expect(selectedState.selection.from).toBe(1);
    expect(selectedState.selection.to).toBe(1);
  });

  it('inserts paired markdown delimiters and places the caret inside them', () => {
    const markdown = '/italic';
    const head = 1 + markdown.length;
    const state = createState(markdown, head);
    const activeRequest = findActiveSlashInsertAutocomplete(state);

    expect(activeRequest).not.toBeNull();

    const tr = buildSelectSlashInsertAutocompleteTransaction(
      state,
      schema,
      activeRequest!,
      findItem('slash-italic'),
    );

    expect(tr).not.toBeNull();

    const selectedState = state.apply(tr!);

    expect(selectedState.doc.toJSON()).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: '**' }],
        },
      ],
    });
    expect(selectedState.selection.from).toBe(2);
    expect(selectedState.selection.to).toBe(2);
  });

  it('inserts link markdown and places the caret between the brackets', () => {
    const markdown = '/link';
    const head = 1 + markdown.length;
    const state = createState(markdown, head);
    const activeRequest = findActiveSlashInsertAutocomplete(state);

    expect(activeRequest).not.toBeNull();

    const tr = buildSelectSlashInsertAutocompleteTransaction(
      state,
      schema,
      activeRequest!,
      findItem('slash-link'),
    );

    expect(tr).not.toBeNull();

    const selectedState = state.apply(tr!);

    expect(selectedState.doc.toJSON()).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: '[]()' }],
        },
      ],
    });
    expect(selectedState.selection.from).toBe(2);
    expect(selectedState.selection.to).toBe(2);
  });

  it('replaces the current block with a table and places the caret in the first cell', () => {
    const markdown = '/table';
    const head = 1 + markdown.length;
    const state = createState(markdown, head);
    const activeRequest = findActiveSlashInsertAutocomplete(state);

    expect(activeRequest).not.toBeNull();

    const tr = buildSelectSlashInsertAutocompleteTransaction(
      state,
      schema,
      activeRequest!,
      findItem('slash-table'),
    );

    expect(tr).not.toBeNull();

    const selectedState = state.apply(tr!);
    const table = selectedState.doc.firstChild;

    expect(table?.type.name).toBe('table');
    expect(table?.childCount).toBe(2);
    expect(table?.child(0).child(0).type.name).toBe('table_header');
    expect(table?.child(1).child(0).type.name).toBe('table_cell');
    expect(selectedState.selection.$from.parent.type.name).toBe('paragraph');
  });
});
