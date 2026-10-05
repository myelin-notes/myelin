import { EditorState } from 'prosemirror-state';
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
