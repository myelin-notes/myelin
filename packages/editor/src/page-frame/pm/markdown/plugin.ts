import { Plugin, PluginKey } from 'prosemirror-state';
import { DecorationSet } from 'prosemirror-view';
import {
  buildMarkdownDecorations,
  buildMarkdownDecorationsForTextblock,
} from './decorations';
import {
  collectAffectedTextblocks,
  getChangedRangesForTransaction,
} from './range-tracking';

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

        const changedRanges = getChangedRangesForTransaction(tr);
        if (changedRanges.length === 0) {
          return prev.map(tr.mapping, tr.doc);
        }

        const mapped = prev.map(tr.mapping, tr.doc);
        const changedBlocks = collectAffectedTextblocks(tr.doc, changedRanges);
        if (changedBlocks.length === 0) {
          return mapped;
        }

        const toRemove = changedBlocks.flatMap(({ pos, node }) =>
          mapped.find(pos, pos + node.nodeSize),
        );
        const next = toRemove.length > 0 ? mapped.remove(toRemove) : mapped;
        const toAdd = changedBlocks.flatMap(({ pos, node }) =>
          buildMarkdownDecorationsForTextblock(node, pos),
        );
        return toAdd.length > 0 ? next.add(tr.doc, toAdd) : next;
      },
    },
    props: {
      decorations(state) {
        return markdownPreviewKey.getState(state) ?? DecorationSet.empty;
      },
    },
  });
}
