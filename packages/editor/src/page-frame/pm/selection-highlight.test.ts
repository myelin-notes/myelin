import { AllSelection, EditorState, TextSelection } from 'prosemirror-state';
import { DecorationSet } from 'prosemirror-view';
import { describe, expect, it } from 'vitest';
import { schema } from './schema';
import { selectionHighlightPlugin } from './selection-highlight';

const plugin = selectionHighlightPlugin();

function markerRanges(state: EditorState) {
  const decorations = plugin.props.decorations?.call(plugin, state);
  if (!(decorations instanceof DecorationSet)) {
    return [];
  }
  return decorations
    .find()
    .filter(
      (decoration) =>
        (decoration as unknown as { type: { attrs: { class: string } } }).type
          .attrs.class === 'pm-list-marker-selected',
    )
    .map(({ from, to }) => [from, to]);
}

describe('list marker selection highlights', () => {
  it.each([
    'orderedListItem',
    'bulletListItem',
    'checkListItem',
  ])('highlights %s markers on select-all, including empty items', (type) => {
    const doc = schema.nodes.doc.create(null, [
      schema.nodes[type].create(null, schema.text('item')),
      schema.nodes[type].create(),
    ]);
    const state = EditorState.create({ doc, selection: new AllSelection(doc) });

    expect(markerRanges(state)).toEqual([
      [0, 6],
      [6, 8],
    ]);
  });

  it('highlights only whole items crossed by a text selection', () => {
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.orderedListItem.create(null, schema.text('first')),
      schema.nodes.orderedListItem.create(null, schema.text('middle')),
      schema.nodes.orderedListItem.create(null, schema.text('last')),
    ]);
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 3, 18),
    });

    expect(markerRanges(state)).toEqual([[7, 15]]);
  });

  it('clears marker highlights when select-all collapses to a cursor', () => {
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.orderedListItem.create(null, schema.text('item')),
    ]);
    const state = EditorState.create({ doc, selection: new AllSelection(doc) });
    const next = state.apply(
      state.tr.setSelection(TextSelection.create(doc, 1)),
    );

    expect(markerRanges(state)).toEqual([[0, 6]]);
    expect(markerRanges(next)).toEqual([]);
  });
});
