import { Plugin } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

export function selectionHighlightPlugin(): Plugin {
  return new Plugin({
    props: {
      decorations(state) {
        const { from, to } = state.selection;
        if (from === to) {
          return DecorationSet.empty;
        }

        return DecorationSet.create(state.doc, [
          Decoration.inline(from, to, { class: 'pm-selection' }),
        ]);
      },
    },
  });
}
