import { EditorState, TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { describe, expect, it } from 'vitest';
import { serializeDocToMarkdown } from '../../markdown/serializer';
import { schema } from '../schema';
import { inlineMarkInputRules } from './inline-marks';

function typeAtEnd(text: string, typed: string): EditorState {
  const plugin = inlineMarkInputRules(schema);
  const base = EditorState.create({
    schema,
    plugins: [plugin],
    doc: schema.nodes.doc.create(
      null,
      schema.nodes.paragraph.create(null, schema.text(text)),
    ),
  });
  const caret = 1 + text.length;
  let state = base.apply(
    base.tr.setSelection(TextSelection.create(base.doc, caret)),
  );
  const view = {
    get state() {
      return state;
    },
    composing: false,
    dispatch: (tr: Parameters<EditorState['apply']>[0]) => {
      state = state.apply(tr);
    },
  } as unknown as EditorView;
  const handled = plugin.props.handleTextInput?.call(
    plugin,
    view,
    caret,
    caret,
    typed,
    () => state.tr,
  );
  if (!handled) {
    state = state.apply(state.tr.insertText(typed, caret));
  }
  return state;
}

describe('inlineMarkInputRules', () => {
  it('stores typed bold as a mark that exports as real markdown', () => {
    const state = typeAtEnd('see **important*', '*');

    expect(state.doc.textContent).toBe('see important');
    expect(serializeDocToMarkdown(state.doc)).toBe('see **important**\n');
  });

  it('waits for the second closing asterisk rather than making bold italic', () => {
    const state = typeAtEnd('**important', '*');

    expect(state.doc.textContent).toBe('**important*');
  });

  it('leaves asterisks inside math as source', () => {
    const state = typeAtEnd('$a*b', '*');

    expect(state.doc.textContent).toBe('$a*b*');
  });

  it('does not extend the mark over text typed after it', () => {
    const state = typeAtEnd('`code', '`');

    expect(state.doc.textContent).toBe('code');
    expect(state.storedMarks ?? []).toEqual([]);
  });
});
