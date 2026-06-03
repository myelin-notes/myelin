import type { Node as PMNode } from 'prosemirror-model';
import {
  EditorState,
  TextSelection,
  type Transaction,
} from 'prosemirror-state';
import { describe, expect, it } from 'vitest';
import { schema } from '../schema';
import {
  exitMathBlock,
  mathBlockNormalizationPlugin,
  openMathBlockOnEnter,
} from './block-commands';

function paragraph(text: string): PMNode {
  return text.length > 0
    ? schema.nodes.paragraph.create(null, schema.text(text))
    : schema.nodes.paragraph.create();
}

function mathBlock(text: string): PMNode {
  return schema.nodes.mathBlock.create(null, schema.text(text));
}

function stateWithSelection(
  doc: PMNode,
  selectionPos: number,
  plugins: EditorState['plugins'] = [],
): EditorState {
  const state = EditorState.create({ schema, doc, plugins });
  return state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, selectionPos)),
  );
}

function applyCommand(
  state: EditorState,
  command: (state: EditorState, dispatch: (tr: Transaction) => void) => boolean,
): EditorState {
  let tr: Transaction | null = null;
  expect(command(state, (nextTr) => (tr = nextTr))).toBe(true);
  return state.apply(tr!);
}

describe('openMathBlockOnEnter', () => {
  it('converts a `$$` paragraph into a math block with the cursor on the content line', () => {
    const doc = schema.nodes.doc.create(null, [paragraph('$$')]);
    const state = stateWithSelection(doc, 3); // end of "$$"

    const nextState = applyCommand(state, openMathBlockOnEnter);
    expect(nextState.doc.toJSON()).toEqual({
      type: 'doc',
      content: [
        { type: 'mathBlock', content: [{ type: 'text', text: '$$\n\n$$' }] },
      ],
    });
    // Cursor sits on the empty line between the fences.
    expect(nextState.selection.from).toBe(4);
    expect(nextState.selection.empty).toBe(true);
  });

  it('does not fire on other paragraphs', () => {
    const doc = schema.nodes.doc.create(null, [paragraph('$$x')]);
    const state = stateWithSelection(doc, 4);
    expect(openMathBlockOnEnter(state, undefined)).toBe(false);
  });
});

describe('exitMathBlock', () => {
  it('exits when the cursor is on the closing fence line', () => {
    const doc = schema.nodes.doc.create(null, [mathBlock('$$\nx\n$$')]);
    const state = stateWithSelection(doc, 8); // end of closing "$$"

    const nextState = applyCommand(state, exitMathBlock);
    expect(nextState.doc.childCount).toBe(2);
    expect(nextState.doc.child(1).type.name).toBe('paragraph');
    expect(nextState.selection.$from.parent.type.name).toBe('paragraph');
  });

  it('stays inside the block on content lines', () => {
    const doc = schema.nodes.doc.create(null, [mathBlock('$$\nx\n$$')]);
    const state = stateWithSelection(doc, 5); // inside "x" line
    expect(exitMathBlock(state, undefined)).toBe(false);
  });
});

describe('mathBlockNormalizationPlugin', () => {
  it('unwraps a math block whose opening fence is destroyed', () => {
    const doc = schema.nodes.doc.create(null, [mathBlock('$$\nx\n$$')]);
    const state = stateWithSelection(doc, 2, [
      mathBlockNormalizationPlugin(schema),
    ]);

    // Delete one `$` from the opening fence -> "$\nx\n$$" is invalid.
    const nextState = state.apply(state.tr.delete(1, 2));
    expect(nextState.doc.toJSON()).toEqual({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: '$' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'x' }] },
        { type: 'paragraph', content: [{ type: 'text', text: '$$' }] },
      ],
    });
  });

  it('leaves valid math blocks alone', () => {
    const doc = schema.nodes.doc.create(null, [mathBlock('$$\nx\n$$')]);
    const state = stateWithSelection(doc, 5, [
      mathBlockNormalizationPlugin(schema),
    ]);

    const nextState = state.apply(state.tr.insertText('y', 5));
    expect(nextState.doc.firstChild?.type.name).toBe('mathBlock');
    expect(nextState.doc.firstChild?.textContent).toBe('$$\nxy\n$$');
  });
});
