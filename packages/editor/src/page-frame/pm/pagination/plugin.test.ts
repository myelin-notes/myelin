import { EditorState } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { describe, expect, it } from 'vitest';
import { schema } from '../schema';
import { type Break, DEFAULT_PAGE_GEOMETRY } from './core';
import { buildPaginationDecorations } from './decoration-renderer';
import { paginationPlugin } from './plugin';

function paginatedState() {
  const plugin = paginationPlugin();
  const base = EditorState.create({
    schema,
    plugins: [plugin],
    doc: schema.node('doc', null, [
      schema.node('heading', { level: 1 }, schema.text('Title')),
      schema.node('paragraph', null, schema.text('Next page')),
    ]),
  });
  const breaks: Break[] = [
    { pos: base.doc.child(0).nodeSize, spacer: 100, kind: 'block' },
  ];
  const decos = buildPaginationDecorations(
    { state: base } as EditorView,
    breaks,
    DEFAULT_PAGE_GEOMETRY,
  );
  const state = base.apply(
    base.tr.setMeta(plugin, { decos, breaks, pageCount: 2 }),
  );
  return { plugin, state };
}

describe('paginationPlugin state', () => {
  // Layout ignores spacers, so a break left without its widget compares equal to the next
  // pass's result and the spacer never comes back.
  it('forgets a break whose widget an edit removed', () => {
    const { plugin, state } = paginatedState();

    const next = state.apply(
      state.tr.setNodeMarkup(0, undefined, { level: 2 }),
    );

    const { breaks, decos } = plugin.getState(next);
    expect(decos.find()).toEqual([]);
    expect(breaks).toEqual([]);
  });

  it('keeps a break whose widget survives, at its new position', () => {
    const { plugin, state } = paginatedState();

    const next = state.apply(state.tr.insertText('x', 1));

    expect(plugin.getState(next).breaks).toMatchObject([
      { pos: state.doc.child(0).nodeSize + 1 },
    ]);
  });
});
