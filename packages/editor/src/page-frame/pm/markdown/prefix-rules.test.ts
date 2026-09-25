import {
  EditorState,
  TextSelection,
  type Transaction,
} from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { describe, expect, it } from 'vitest';
import { schema } from '../schema';
import { prefixMarkdownInputRules } from './prefix-rules';

function typeSpace(blockType: string, prefix: string, level = 1) {
  const plugin = prefixMarkdownInputRules(schema);
  const doc = schema.nodes.doc.create(null, [
    schema.nodes[blockType].create({ level }, schema.text(prefix)),
  ]);
  let state = EditorState.create({
    schema,
    doc,
    selection: TextSelection.create(doc, prefix.length + 1),
    plugins: [plugin],
  });
  const view = {
    state,
    composing: false,
    dispatch(tr: Transaction) {
      state = state.apply(tr);
    },
  } as unknown as EditorView;
  const { from, to } = state.selection;
  const handled = plugin.props.handleTextInput?.call(
    plugin,
    view,
    from,
    to,
    ' ',
    () => state.tr.insertText(' ', from, to),
  );
  if (!handled) {
    state = state.apply(state.tr.insertText(' '));
  }
  return state.doc.firstChild!;
}

describe('block prefix input rules', () => {
  it.each([
    1, 2, 3,
  ])('keeps block prefixes literal in heading level %i', (level) => {
    for (const prefix of [
      '1.',
      '12.',
      '-',
      '*',
      '[ ]',
      '[x]',
      '#',
      '##',
      '###',
      '>',
    ]) {
      const block = typeSpace('heading', prefix, level);
      expect(block.type.name).toBe('heading');
      expect(block.attrs.level).toBe(level);
      expect(block.textContent).toBe(`${prefix} `);
    }
  });

  it.each([
    'blockquote',
    'bulletListItem',
    'orderedListItem',
    'checkListItem',
  ])('keeps block prefixes literal in an existing %s', (type) => {
    for (const prefix of ['1.', '-', '*', '#', '>']) {
      const block = typeSpace(type, prefix);
      expect(block.type.name).toBe(type);
      expect(block.textContent).toBe(`${prefix} `);
    }
  });

  it('still converts a bullet item into a checklist', () => {
    const block = typeSpace('bulletListItem', '[x]');
    expect(block.type.name).toBe('checkListItem');
    expect(block.attrs.checked).toBe(true);
    expect(block.textContent).toBe('');
  });

  it.each([
    ['1.', 'orderedListItem'],
    ['12.', 'orderedListItem'],
    ['-', 'bulletListItem'],
    ['*', 'bulletListItem'],
    ['[ ]', 'checkListItem'],
    ['#', 'heading'],
    ['>', 'blockquote'],
  ])('converts %s in a paragraph to %s', (prefix, type) => {
    const block = typeSpace('paragraph', prefix);
    expect(block.type.name).toBe(type);
    expect(block.textContent).toBe('');
    if (type === 'orderedListItem') {
      expect(block.attrs.order).toBe(Number.parseInt(prefix, 10));
    }
  });
});
