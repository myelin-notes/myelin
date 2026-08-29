import { EditorState, type Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { describe, expect, it } from 'vitest';
import { serializeDocToMarkdown } from '../markdown/serializer';
import { schema } from '../pm/schema';
import {
  findBand,
  insertBand,
  listBandIds,
  removeBands,
  setBandHeight,
} from './band';

// Tests run in node, so there is no DOM to mount a real view on. The band helpers only need
// `state` and `dispatch`, and this applies transactions for real.
function makeView(): EditorView {
  let state = EditorState.create({
    schema,
    doc: schema.node('doc', null, [
      schema.node('paragraph', null, [schema.text('first')]),
      schema.node('paragraph', null, [schema.text('second')]),
    ]),
  });
  return {
    get state() {
      return state;
    },
    dispatch(tr: Transaction) {
      state = state.apply(tr);
    },
  } as unknown as EditorView;
}

/** Doc position immediately before the nth top-level block. */
function posOfBlock(view: EditorView, index: number): number {
  const positions: number[] = [];
  view.state.doc.forEach((_node, pos) => {
    positions.push(pos);
  });
  return positions[index];
}

describe('canvas bands', () => {
  it('inserts a band at a block boundary without disturbing the blocks', () => {
    const view = makeView();
    const bandId = insertBand(view, posOfBlock(view, 1), 0);

    const names: string[] = [];
    view.state.doc.forEach((node) => {
      names.push(node.type.name);
    });
    expect(names).toEqual(['paragraph', 'canvasBand', 'paragraph']);
    expect(listBandIds(view.state.doc)).toEqual([bandId]);
    expect(findBand(view.state.doc, bandId)?.node.attrs.height).toBe(0);
  });

  it('reserves and releases height in place', () => {
    const view = makeView();
    const bandId = insertBand(view, posOfBlock(view, 1), 0);

    setBandHeight(view, bandId, 120);
    expect(findBand(view.state.doc, bandId)?.node.attrs.height).toBe(120);

    setBandHeight(view, bandId, 0);
    expect(findBand(view.state.doc, bandId)?.node.attrs.height).toBe(0);
    expect(listBandIds(view.state.doc)).toEqual([bandId]);
  });

  it('removes several bands at once, leaving unlisted ones alone', () => {
    const view = makeView();
    const first = insertBand(view, posOfBlock(view, 0), 40);
    const second = insertBand(view, posOfBlock(view, 2), 40);
    const third = insertBand(view, view.state.doc.content.size, 40);

    removeBands(view, new Set([first, third]));

    expect(listBandIds(view.state.doc)).toEqual([second]);
    expect(view.state.doc.textContent).toBe('firstsecond');
  });

  it('leaves no trace in exported markdown', () => {
    const view = makeView();
    setBandHeight(view, insertBand(view, posOfBlock(view, 1), 0), 200);

    expect(serializeDocToMarkdown(view.state.doc)).toBe('first\n\nsecond\n');
  });
});
