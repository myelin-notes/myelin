import { EditorState, TextSelection } from 'prosemirror-state';
import { describe, expect, it } from 'vitest';
import { parseMarkdownToDoc } from '../../markdown/parser';
import { schema } from '../schema';
import {
  buildSelectMediaPathAutocompleteTransaction,
  findActiveMediaPathAutocomplete,
} from './media-path';

function createState(markdown: string, head: number) {
  const state = EditorState.create({
    schema,
    doc: parseMarkdownToDoc(markdown, schema),
  });

  return state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, head)),
  );
}

describe('findActiveMediaPathAutocomplete', () => {
  it('activates when the caret is inside a `/`-rooted image path', () => {
    const markdown = '![](/Animals/ca';
    const head = 1 + markdown.length;
    const urlStart = 1 + '![]('.length;
    const state = createState(markdown, head);

    expect(findActiveMediaPathAutocomplete(state)).toEqual({
      query: '/Animals/ca',
      range: { from: urlStart, to: head },
      replaceRange: { from: urlStart, to: head },
      anchorPosition: head,
    });
  });

  it('captures a path containing spaces (no encoding)', () => {
    const markdown = '![](/My Pics/my ca';
    const head = 1 + markdown.length;
    const state = createState(markdown, head);

    expect(findActiveMediaPathAutocomplete(state)?.query).toBe(
      '/My Pics/my ca',
    );
  });

  it('activates immediately after the leading slash is typed', () => {
    const markdown = '![](/';
    const head = 1 + markdown.length;
    const state = createState(markdown, head);

    const request = findActiveMediaPathAutocomplete(state);
    expect(request?.query).toBe('/');
  });

  it('ignores external and protocol-relative urls', () => {
    for (const url of ['https://example.com/a.png', '//cdn/a.png', 'a.png']) {
      const markdown = `![](${url}`;
      const state = createState(markdown, 1 + markdown.length);
      expect(findActiveMediaPathAutocomplete(state)).toBeNull();
    }
  });

  it('does not activate for plain links (single bracket)', () => {
    const markdown = '[](/Animals';
    const state = createState(markdown, 1 + markdown.length);
    expect(findActiveMediaPathAutocomplete(state)).toBeNull();
  });
});

describe('buildSelectMediaPathAutocompleteTransaction', () => {
  it('replaces the typed path with the selected item and keeps the caret in the url', () => {
    const markdown = '![](/Ani)';
    // Caret sits just before the closing paren, after `/Ani`.
    const head = 1 + '![](/Ani'.length;
    const state = createState(markdown, head);
    const request = findActiveMediaPathAutocomplete(state);
    expect(request).not.toBeNull();

    const tr = buildSelectMediaPathAutocompleteTransaction(
      state,
      schema,
      request!,
      { id: 'file-1', title: 'cat.png', insertText: '/Animals/cat.png' },
    );
    expect(tr).not.toBeNull();

    const next = state.apply(tr!);
    expect(next.doc.textContent).toBe('![](/Animals/cat.png)');
    // Caret lands right after the inserted path (before the closing paren).
    const urlStart = 1 + '![]('.length;
    expect(next.selection.head).toBe(urlStart + '/Animals/cat.png'.length);
  });
});
