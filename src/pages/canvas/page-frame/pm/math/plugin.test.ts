import type { Node as PMNode } from 'prosemirror-model';
import { EditorState, TextSelection } from 'prosemirror-state';
import { describe, expect, it } from 'vitest';
import { schema } from '../schema';
import { mathPreviewPlugin } from './plugin';

function paragraph(text: string): PMNode {
  return schema.nodes.paragraph.create(null, schema.text(text));
}

function createState(doc: PMNode, selectionPos: number) {
  const plugin = mathPreviewPlugin();
  let state = EditorState.create({ schema, doc, plugins: [plugin] });
  state = state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, selectionPos)),
  );
  return { plugin, state };
}

function findDecorations(
  plugin: ReturnType<typeof mathPreviewPlugin>,
  state: EditorState,
) {
  return plugin.getState(state)?.find() ?? [];
}

describe('mathPreviewPlugin', () => {
  it('replaces inline math with a widget when the selection is elsewhere', () => {
    const doc = schema.nodes.doc.create(null, [paragraph('a $x^2$ b')]);
    const { plugin, state } = createState(doc, 1);

    const decorations = findDecorations(plugin, state);
    // One replace decoration over `$x^2$` plus one widget.
    expect(decorations).toHaveLength(2);
    const replace = decorations.find((deco) => deco.to > deco.from);
    expect(replace).toMatchObject({ from: 3, to: 8 });
  });

  it('shows the raw source while the selection is inside the range', () => {
    const doc = schema.nodes.doc.create(null, [paragraph('a $x^2$ b')]);
    const { plugin, state } = createState(doc, 5);

    expect(findDecorations(plugin, state)).toHaveLength(0);
  });

  it('keeps the preview when the cursor sits at a boundary', () => {
    const doc = schema.nodes.doc.create(null, [paragraph('a $x^2$ b')]);
    // Just before the opening `$` and just after the closing `$`.
    const before = createState(doc, 3);
    expect(findDecorations(before.plugin, before.state)).toHaveLength(2);
    const after = createState(doc, 8);
    expect(findDecorations(after.plugin, after.state)).toHaveLength(2);
  });

  it('updates decorations as the selection moves in and out', () => {
    const doc = schema.nodes.doc.create(null, [paragraph('a $x^2$ b')]);
    const { plugin, state } = createState(doc, 1);
    expect(findDecorations(plugin, state)).toHaveLength(2);

    const inside = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, 5)),
    );
    expect(findDecorations(plugin, inside)).toHaveLength(0);

    const outside = inside.apply(
      inside.tr.setSelection(TextSelection.create(inside.doc, 1)),
    );
    expect(findDecorations(plugin, outside)).toHaveLength(2);
  });

  it('marks a math block as editing while the selection is inside it', () => {
    const mathBlock = schema.nodes.mathBlock.create(
      null,
      schema.text('$$\nx\n$$'),
    );
    const doc = schema.nodes.doc.create(null, [mathBlock, paragraph('after')]);

    const { plugin, state } = createState(doc, 5);
    const editing = findDecorations(plugin, state);
    expect(editing).toHaveLength(1);
    expect(editing[0].from).toBe(0);

    const outside = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, 11)),
    );
    expect(findDecorations(plugin, outside)).toHaveLength(0);
  });

  it('keeps the preview when a selection spans the math block', () => {
    const mathBlock = schema.nodes.mathBlock.create(
      null,
      schema.text('$$\nx\n$$'),
    );
    const doc = schema.nodes.doc.create(null, [
      paragraph('before'),
      mathBlock,
      paragraph('after'),
    ]);

    // From inside the first paragraph to inside the last — the block is
    // touched but the selection is not contained in it, so it must keep the
    // preview (only contained selections open the shared source editor).
    const plugin = mathPreviewPlugin();
    let state = EditorState.create({ schema, doc, plugins: [plugin] });
    state = state.apply(
      state.tr.setSelection(
        TextSelection.create(state.doc, 2, state.doc.content.size - 2),
      ),
    );
    expect(findDecorations(plugin, state)).toHaveLength(0);
  });

  it('rebuilds decorations for edited blocks', () => {
    const doc = schema.nodes.doc.create(null, [
      paragraph('a $x^2$ b'),
      paragraph('end'),
    ]);
    // Selection in the second paragraph; math renders in the first.
    const { plugin, state } = createState(doc, 12);
    expect(findDecorations(plugin, state)).toHaveLength(2);

    // Deleting the closing `$` invalidates the range.
    const edited = state.apply(state.tr.delete(7, 8));
    expect(findDecorations(plugin, edited)).toHaveLength(0);
  });
});
