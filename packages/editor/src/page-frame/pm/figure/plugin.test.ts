import { EditorState, TextSelection } from 'prosemirror-state';
import { describe, expect, it } from 'vitest';
import { schema } from '../schema';
import {
  exitFigureCaption,
  figureMarkdownPlugin,
  removeFigureAtCaptionStart,
} from './plugin';

function typed(text: string, caretOffset: number) {
  const empty = EditorState.create({
    schema,
    plugins: [figureMarkdownPlugin(schema)],
    doc: schema.nodes.doc.create(null, schema.nodes.paragraph.create()),
  });
  const tr = empty.tr.insertText(text, 1);
  tr.setSelection(TextSelection.create(tr.doc, 1 + caretOffset));
  return empty.applyTransaction(tr).state;
}

describe('figureMarkdownPlugin', () => {
  it('converts a completed image line, moving the caret into the caption', () => {
    const text = '![a](/b.png)';

    const state = typed(text, text.length);

    expect(state.doc.child(0).type.name).toBe('figure');
    expect(state.selection.$from.parent.type.name).toBe('figure');
  });

  it('waits while the caret is still inside the URL', () => {
    const state = typed('![a](/b.png)', 8);

    expect(state.doc.child(0).type.name).toBe('paragraph');
  });

  it('converts once the caret leaves the paragraph', () => {
    const state = typed('![a](/b.png)', 8);
    const withNext = state.applyTransaction(
      state.tr.insert(state.doc.content.size, schema.nodes.paragraph.create()),
    ).state;

    const moved = withNext.applyTransaction(
      withNext.tr.setSelection(
        TextSelection.create(withNext.doc, withNext.doc.content.size - 1),
      ),
    ).state;

    expect(moved.doc.child(0).type.name).toBe('figure');
  });
});

describe('figure caption keys', () => {
  function captionState(offset: number) {
    const doc = schema.nodes.doc.create(
      null,
      schema.nodes.figure.create({ src: '/a.png' }, schema.text('Cap')),
    );
    return EditorState.create({
      schema,
      doc,
      selection: TextSelection.create(doc, 1 + offset),
    });
  }

  it('Enter adds a paragraph instead of splitting the figure', () => {
    let state = captionState(1);

    exitFigureCaption(state, (tr) => {
      state = state.apply(tr);
    });

    expect(state.doc.childCount).toBe(2);
    expect(state.doc.child(0).textContent).toBe('Cap');
    expect(state.selection.$from.parent.type.name).toBe('paragraph');
  });

  it('Backspace at the caption start removes the image but keeps the caption', () => {
    let state = captionState(0);

    removeFigureAtCaptionStart(state, (tr) => {
      state = state.apply(tr);
    });

    expect(state.doc.child(0).type.name).toBe('paragraph');
    expect(state.doc.textContent).toBe('Cap');
  });

  it('Backspace mid-caption is left to normal editing', () => {
    expect(removeFigureAtCaptionStart(captionState(2))).toBe(false);
  });
});
