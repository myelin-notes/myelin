import { Plugin, PluginKey } from 'prosemirror-state';
import { DecorationSet } from 'prosemirror-view';
import { buildMarkdownDecorations } from './decorations';

const markdownPreviewKey = new PluginKey<DecorationSet>('markdown-preview');

export function markdownPreviewPlugin(): Plugin {
  return new Plugin({
    key: markdownPreviewKey,
    state: {
      init(_, state) {
        return DecorationSet.create(
          state.doc,
          buildMarkdownDecorations(state.doc),
        );
      },
      apply(tr, prev) {
        if (!tr.docChanged) {
          return prev;
        }
        return DecorationSet.create(tr.doc, buildMarkdownDecorations(tr.doc));
      },
    },
    props: {
      decorations(state) {
        return markdownPreviewKey.getState(state) ?? DecorationSet.empty;
      },
    },
  });
}
