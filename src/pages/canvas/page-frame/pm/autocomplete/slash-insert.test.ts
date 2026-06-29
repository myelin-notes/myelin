import { EditorState, TextSelection } from 'prosemirror-state';
import { describe, expect, it } from 'vitest';
import en from '@/lib/i18n/messages/en';
import { parseMarkdownToDoc } from '../../markdown/parser';
import { schema } from '../schema';
import type { PageFrameAutocompleteItem } from './index';
import {
  buildSelectSlashInsertAutocompleteTransaction,
  findActiveSlashInsertAutocomplete,
  searchSlashInsertAutocompleteItems,
} from './slash-insert';

const labels = en.canvas.slashInsert;

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
  const item = searchSlashInsertAutocompleteItems('', labels).find(
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
      allowBlockActions: true,
    });
  });

  it('detects an inline slash after a space', () => {
    const markdown = 'Alpha /to';
    const head = 1 + markdown.length;
    const state = createState(markdown, head);

    const active = findActiveSlashInsertAutocomplete(state);
    expect(active).not.toBeNull();
    expect(active?.query).toBe('to');
    expect(active?.allowBlockActions).toBe(false);
  });

  it('allows block actions when the slash is at the start of the block', () => {
    const markdown = '/head';
    const head = 1 + markdown.length;
    const state = createState(markdown, head);

    expect(findActiveSlashInsertAutocomplete(state)?.allowBlockActions).toBe(
      true,
    );
  });

  it('does not trigger when the slash is mid-word with no preceding space', () => {
    const markdown = 'and/or';
    const head = 1 + markdown.length;
    const state = createState(markdown, head);

    expect(findActiveSlashInsertAutocomplete(state)).toBeNull();
  });
});

describe('searchSlashInsertAutocompleteItems', () => {
  it('matches aliases like h2, links, and inline code', () => {
    expect(searchSlashInsertAutocompleteItems('h2', labels)[0]?.id).toBe(
      'slash-heading-2',
    );
    expect(searchSlashInsertAutocompleteItems('hyperlink', labels)[0]?.id).toBe(
      'slash-link',
    );
    expect(searchSlashInsertAutocompleteItems('table', labels)[0]?.id).toBe(
      'slash-table',
    );
    expect(searchSlashInsertAutocompleteItems('code', labels)[0]?.id).toBe(
      'slash-inline-code',
    );
  });

  it('returns every item for an empty query without truncating', () => {
    const ids = searchSlashInsertAutocompleteItems('', labels).map(
      (item) => item.id,
    );
    expect(ids).toContain('slash-note-link');
  });

  it('excludes block and table items when block actions are disallowed', () => {
    const ids = searchSlashInsertAutocompleteItems('', labels, false).map(
      (item) => item.id,
    );
    expect(ids).not.toContain('slash-heading-1');
    expect(ids).not.toContain('slash-bullet-list');
    expect(ids).not.toContain('slash-table');
    expect(ids).not.toContain('slash-paragraph');
    expect(ids).toContain('slash-link');
    expect(ids).toContain('slash-date-today');
  });

  it('keeps block and table items when block actions are allowed', () => {
    const ids = searchSlashInsertAutocompleteItems('', labels, true).map(
      (item) => item.id,
    );
    expect(ids).toContain('slash-heading-1');
    expect(ids).toContain('slash-table');
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

  it("inserts today's date formatted in the active locale", () => {
    const markdown = '/today';
    const head = 1 + markdown.length;
    const state = createState(markdown, head);
    const activeRequest = findActiveSlashInsertAutocomplete(state);

    expect(activeRequest).not.toBeNull();

    const tr = buildSelectSlashInsertAutocompleteTransaction(
      state,
      schema,
      activeRequest!,
      findItem('slash-date-today'),
    );

    expect(tr).not.toBeNull();

    const expected = new Intl.DateTimeFormat(undefined, {
      dateStyle: 'long',
    }).format(new Date());
    const selectedState = state.apply(tr!);

    expect(selectedState.doc.toJSON()).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: expected }],
        },
      ],
    });
    expect(selectedState.selection.from).toBe(1 + expected.length);
    expect(selectedState.selection.to).toBe(1 + expected.length);
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
