import { EditorState, TextSelection } from 'prosemirror-state';
import { describe, expect, it } from 'vitest';
import type { TextStyle } from './element';
import {
  applySelectionStyle,
  docFromJson,
  docFromText,
  getDocText,
  getSelectionStyle,
  textSchema,
} from './rich-text';

const base: TextStyle = {
  color: '#111111',
  fontSize: 24,
  fontFamily: 'Inter',
  bold: false,
  italic: false,
};

describe('textbox rich text', () => {
  it('round-trips newlines through the document JSON', () => {
    const doc = docFromText('first\nsecond');
    expect(getDocText(docFromJson(doc.toJSON(), 'fallback'))).toBe(
      'first\nsecond',
    );
  });

  it('applies independent styles without replacing other span attributes', () => {
    let state = EditorState.create({
      schema: textSchema,
      doc: docFromText('hello'),
    });
    state = state.apply(
      applySelectionStyle(
        state.apply(
          state.tr.setSelection(TextSelection.create(state.doc, 0, 2)),
        ),
        { fontFamily: 'Lora' },
      ),
    );
    state = state.apply(
      applySelectionStyle(
        state.apply(
          state.tr.setSelection(TextSelection.create(state.doc, 0, 2)),
        ),
        { color: '#ff0000', bold: true },
      ),
    );

    const first = state.doc.nodeAt(0);
    expect(
      first?.marks.find((mark) => mark.type === textSchema.marks.textStyle)
        ?.attrs,
    ).toMatchObject({
      color: '#ff0000',
      fontFamily: 'Lora',
    });
    expect(
      first?.marks.find((mark) => mark.type === textSchema.marks.textStyle)
        ?.attrs.bold,
    ).toBe(true);
    expect(state.doc.nodeAt(2)?.marks).toHaveLength(0);
    expect(getSelectionStyle(state, base)).toMatchObject({
      bold: true,
      color: '#ff0000',
      fontFamily: 'Lora',
    });
  });

  it('sets stored marks at a caret for newly typed text', () => {
    const state = EditorState.create({
      schema: textSchema,
      doc: docFromText('hello'),
    });
    const next = state.apply(applySelectionStyle(state, { italic: true }));
    expect(getSelectionStyle(next, base).italic).toBe(true);
  });

  it('inherits font fields when only bold or italic is set', () => {
    const state = EditorState.create({
      schema: textSchema,
      doc: docFromText('hello'),
    });
    const next = state.apply(applySelectionStyle(state, { bold: true }));

    expect(getSelectionStyle(next, base)).toEqual({
      ...base,
      bold: true,
    });
  });
});
