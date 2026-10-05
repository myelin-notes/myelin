import { EditorState, TextSelection } from 'prosemirror-state';
import { describe, expect, it } from 'vitest';
import type { TextStyle } from './element';
import {
  applyDocumentStyle,
  applySelectionStyle,
  docFromJson,
  docFromText,
  getDocText,
  getDocumentStyle,
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

  it('reads formatting from the selected range instead of its leading boundary', () => {
    let state = EditorState.create({
      schema: textSchema,
      doc: docFromText('plain italic'),
    });
    state = state.apply(
      applySelectionStyle(
        state.apply(
          state.tr.setSelection(TextSelection.create(state.doc, 6, 12)),
        ),
        { color: '#ff0000', italic: true },
      ),
    );
    state = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, 6, 12)),
    );

    expect(getSelectionStyle(state, base).italic).toBe(true);
    expect(getSelectionStyle(state, base).color).toBe('#ff0000');

    state = state.apply(applySelectionStyle(state, { italic: false }));
    expect(getSelectionStyle(state, base).italic).toBe(false);
  });

  it('inherits the textbox style across an unmarked text selection', () => {
    const doc = docFromText('italic');
    const state = EditorState.create({
      schema: textSchema,
      doc,
      selection: TextSelection.create(doc, 0, 6),
    });

    expect(getSelectionStyle(state, { ...base, italic: true }).italic).toBe(
      true,
    );
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

  it('reads formatting from the text when the whole textbox is targeted', () => {
    const state = EditorState.create({
      schema: textSchema,
      doc: docFromText('hello'),
    });
    const next = state.apply(applyDocumentStyle(state, { italic: true }));

    expect(getDocumentStyle(next.doc, base).italic).toBe(true);
  });

  it('applies formatting to every text run in the textbox', () => {
    let state = EditorState.create({
      schema: textSchema,
      doc: docFromText('hello world'),
    });
    state = state.apply(
      applySelectionStyle(
        state.apply(
          state.tr.setSelection(TextSelection.create(state.doc, 0, 5)),
        ),
        { color: '#ff0000' },
      ),
    );
    state = state.apply(applyDocumentStyle(state, { italic: true }));

    state.doc.descendants((node) => {
      if (!node.isText) {
        return;
      }
      expect(
        node.marks.find((mark) => mark.type === textSchema.marks.textStyle)
          ?.attrs.italic,
      ).toBe(true);
    });
  });
});
