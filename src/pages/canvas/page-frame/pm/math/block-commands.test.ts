import type { Node as PMNode } from 'prosemirror-model';
import {
  EditorState,
  TextSelection,
  type Transaction,
} from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { describe, expect, it } from 'vitest';
import { schema } from '../schema';
import {
  exitMathBlock,
  mathBlockInputRules,
  mathBlockNormalizationPlugin,
  selectAllInMathBlock,
} from './block-commands';

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

/**
 * Drives the inputRules plugin's handleTextInput with a minimal fake view,
 * simulating the user typing `text` at the cursor. Returns the resulting
 * state, or null when no rule fired.
 */
function typeText(state: EditorState, text: string): EditorState | null {
  const plugin = mathBlockInputRules(schema);
  const withPlugin = state.reconfigure({ plugins: [plugin] });
  let result: EditorState | null = null;
  const view = {
    state: withPlugin,
    composing: false,
    dispatch(tr: Transaction) {
      result = withPlugin.apply(tr);
    },
  } as unknown as EditorView;

  const { from, to } = withPlugin.selection;
  const handled = plugin.props.handleTextInput?.call(
    plugin,
    view,
    from,
    to,
    text,
    () => withPlugin.tr.insertText(text, from, to),
  );
  return handled ? result : null;
}

describe('single-line math input rule', () => {
  it('converts a $$...$$ paragraph when the final $ is typed', () => {
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(null, schema.text('$$x^2$')),
    ]);
    const state = stateWithSelection(doc, 7); // end of paragraph

    const nextState = typeText(state, '$');
    expect(nextState).not.toBeNull();
    expect(nextState!.doc.toJSON()).toEqual({
      type: 'doc',
      content: [
        {
          type: 'mathBlock',
          content: [{ type: 'text', text: '$$\nx^2\n$$' }],
        },
      ],
    });
  });

  it('does not fire mid-paragraph when text follows the cursor', () => {
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(null, schema.text('$$x^2$ tail')),
    ]);
    const state = stateWithSelection(doc, 7); // right after "$$x^2$"

    expect(typeText(state, '$')).toBeNull();
  });

  it('does not convert an empty $$$$ line', () => {
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(null, schema.text('$$$')),
    ]);
    const state = stateWithSelection(doc, 4);

    expect(typeText(state, '$')).toBeNull();
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

describe('selectAllInMathBlock', () => {
  it('selects the content between the fences', () => {
    const doc = schema.nodes.doc.create(null, [mathBlock('$$\nx + y\n$$')]);
    const state = stateWithSelection(doc, 5); // inside "x + y" line

    const nextState = applyCommand(state, selectAllInMathBlock);
    const { from, to } = nextState.selection;
    expect(nextState.doc.textBetween(from, to)).toBe('x + y');
  });

  it('spans multiple content lines', () => {
    const doc = schema.nodes.doc.create(null, [mathBlock('$$\na\nb\n$$')]);
    const state = stateWithSelection(doc, 4);

    const nextState = applyCommand(state, selectAllInMathBlock);
    const { from, to } = nextState.selection;
    expect(nextState.doc.textBetween(from, to)).toBe('a\nb');
  });

  it('falls back to the full source when there is no content', () => {
    const doc = schema.nodes.doc.create(null, [mathBlock('$$\n$$')]);
    const state = stateWithSelection(doc, 2);

    const nextState = applyCommand(state, selectAllInMathBlock);
    const { from, to } = nextState.selection;
    expect(nextState.doc.textBetween(from, to)).toBe('$$\n$$');
  });

  it('does nothing outside a math block', () => {
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(null, schema.text('plain')),
    ]);
    const state = stateWithSelection(doc, 3);
    expect(selectAllInMathBlock(state, undefined)).toBe(false);
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
