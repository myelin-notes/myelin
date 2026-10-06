import {
  EditorState,
  TextSelection,
  type Transaction,
} from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { describe, expect, it } from 'vitest';
import {
  initProseMirrorDoc,
  prosemirrorToYXmlFragment,
  ySyncPlugin,
} from 'y-prosemirror';
import * as Y from 'yjs';
import {
  anchorGapsKey,
  anchorGapsPlugin,
  encodeAnchorPosition,
  resolveAnchorPosition,
  setAnchorGaps,
} from './anchoring';
import { schema } from './schema';

function stateFor(fragment: Y.XmlFragment): EditorState {
  const { doc, mapping } = initProseMirrorDoc(fragment, schema);
  return EditorState.create({
    doc,
    plugins: [ySyncPlugin(fragment, { mapping }), anchorGapsPlugin()],
  });
}

function fixture() {
  const doc = new Y.Doc();
  const fragment = doc.getXmlFragment('page');
  prosemirrorToYXmlFragment(
    schema.node('doc', null, [
      schema.node('paragraph', null, schema.text('above')),
      schema.node('paragraph', null, schema.text('below')),
    ]),
    fragment,
  );
  return { doc, fragment, state: stateFor(fragment) };
}

describe('page frame text positions', () => {
  it('follows text inserted and removed above, including after serialization and remote sync', () => {
    const { doc, fragment, state } = fixture();
    const position = JSON.parse(
      JSON.stringify(encodeAnchorPosition(state, 10)),
    ) as number[];
    const paragraph = fragment.get(0) as Y.XmlElement;
    const text = paragraph.get(0) as Y.XmlText;
    text.insert(0, 'new text ');
    expect(resolveAnchorPosition(stateFor(fragment), position)).toBe(19);
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
    expect(
      resolveAnchorPosition(stateFor(peer.getXmlFragment('page')), position),
    ).toBe(19);
    text.delete(0, 9);
    expect(resolveAnchorPosition(stateFor(fragment), position)).toBe(10);
  });

  it('keeps the anchor when surrounding text and its entire paragraph are deleted', () => {
    const { fragment, state } = fixture();
    const position = encodeAnchorPosition(state, 10);
    const block = encodeAnchorPosition(state, 7);
    const text = (fragment.get(1) as Y.XmlElement).get(0) as Y.XmlText;
    text.delete(0, text.length);
    expect(resolveAnchorPosition(stateFor(fragment), position, block)).toBe(8);
    fragment.delete(1, 1);
    expect(resolveAnchorPosition(stateFor(fragment), position, block)).toBe(7);
  });

  it('maps a reserved gap through deletion without deleting it', () => {
    let { state } = fixture();
    state = state.apply(
      state.tr.setMeta(anchorGapsKey, [{ id: 'image', pos: 10, height: 120 }]),
    );
    state = state.apply(state.tr.insertText('new', 10));
    expect(anchorGapsKey.getState(state)?.[0].pos).toBe(13);
    state = state.apply(state.tr.delete(7, 17));
    expect(anchorGapsKey.getState(state)).toEqual([
      { id: 'image', pos: 7, height: 120 },
    ]);
  });
});

describe('typing below a trailing anchored element', () => {
  function editor() {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment('page');
    prosemirrorToYXmlFragment(
      schema.node('doc', null, [
        schema.node('paragraph', null, schema.text('some text')),
      ]),
      fragment,
    );
    const view = {
      state: stateFor(fragment),
      dispatch(tr: Transaction) {
        const state = this.state.apply(tr);
        prosemirrorToYXmlFragment(state.doc, fragment);
        this.state = stateFor(fragment);
        this.state = this.state.apply(
          this.state.tr.setMeta(anchorGapsKey, anchorGapsKey.getState(state)),
        );
      },
    } as EditorView;
    return view;
  }

  it.each([
    { placement: 'inside the final paragraph', makesSpace: true },
    { placement: 'after the final paragraph', makesSpace: true },
    { placement: 'inside the final paragraph', makesSpace: false },
    { placement: 'after the final paragraph', makesSpace: false },
  ])('allows typing below an anchor $placement with makesSpace=$makesSpace', ({
    placement,
    makesSpace,
  }) => {
    const view = editor();
    const end = view.state.doc.content.size;
    const pos = placement === 'inside the final paragraph' ? end - 1 : end;
    const gaps = makesSpace ? [{ id: 'element', pos, height: 120 }] : [];
    expect(setAnchorGaps(view, gaps, [pos])).toBe(true);
    expect(view.state.doc.childCount).toBe(2);
    expect(anchorGapsKey.getState(view.state)).toEqual(gaps);
    expect(view.state.doc.lastChild?.type.name).toBe('paragraph');
    expect(view.state.doc.lastChild?.content.size).toBe(0);
    const anchor = encodeAnchorPosition(view.state, pos);
    const below = TextSelection.atEnd(view.state.doc);
    expect(below.from).toBeGreaterThan(pos);
    view.dispatch(
      view.state.tr.setSelection(below).insertText('below the image'),
    );
    expect(view.state.doc.lastChild?.textContent).toBe('below the image');
    expect(resolveAnchorPosition(view.state, anchor)).toBe(pos);
    expect(setAnchorGaps(view, gaps, [pos])).toBe(false);
    expect(view.state.doc.childCount).toBe(2);
  });

  it('restores a typing position when the paragraph below the image is deleted', () => {
    const view = editor();
    const end = view.state.doc.content.size;
    const gaps = [{ id: 'image', pos: end - 1, height: 120 }];
    setAnchorGaps(
      view,
      gaps,
      gaps.map((gap) => gap.pos),
    );
    view.dispatch(view.state.tr.delete(end, view.state.doc.content.size));
    expect(
      setAnchorGaps(
        view,
        gaps,
        gaps.map((gap) => gap.pos),
      ),
    ).toBe(true);
    expect(view.state.doc.childCount).toBe(2);
  });
});
