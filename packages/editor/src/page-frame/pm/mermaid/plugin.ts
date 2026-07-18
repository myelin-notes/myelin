import { type EditorState, Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { positionBlockSourcePanels } from '../nested-editor/source-panel';
import { isMermaidBlock } from './detect';
import { MERMAID_SOURCE_PANEL_SELECTOR } from './node-view';

const mermaidPreviewKey = new PluginKey<DecorationSet>('mermaid-preview');

/**
 * Marks the mermaid block containing the selection with an editing class so
 * CSS can reveal the node view's floating source panel — the same contract
 * the math preview plugin provides for math blocks. Editing requires the
 * selection to be contained inside the block's content, not merely
 * overlapping it: a cross-block range keeps the preview.
 */
function buildEditingDecorations(state: EditorState): DecorationSet {
  const { $from, from, to } = state.selection;
  if ($from.depth === 0) {
    return DecorationSet.empty;
  }

  const block = $from.parent;
  if (block.type.name !== 'codeBlock' || !isMermaidBlock(block.textContent)) {
    return DecorationSet.empty;
  }

  const pos = $from.before($from.depth);
  if (from < pos + 1 || to > pos + block.nodeSize - 1) {
    return DecorationSet.empty;
  }

  return DecorationSet.create(state.doc, [
    Decoration.node(pos, pos + block.nodeSize, {
      class: 'pm-mermaid-block--editing',
    }),
  ]);
}

export function mermaidPreviewPlugin(): Plugin<DecorationSet> {
  return new Plugin({
    key: mermaidPreviewKey,
    view(view) {
      positionBlockSourcePanels(view.dom, MERMAID_SOURCE_PANEL_SELECTOR);
      return {
        update(view) {
          positionBlockSourcePanels(view.dom, MERMAID_SOURCE_PANEL_SELECTOR);
        },
      };
    },
    state: {
      init: (_, state) => buildEditingDecorations(state),
      apply(tr, prev, oldState, newState) {
        if (!tr.docChanged && oldState.selection.eq(newState.selection)) {
          return prev;
        }
        // Rebuilding is O(selection depth) — no doc walk, so none of the
        // incremental bookkeeping the math plugin needs.
        return buildEditingDecorations(newState);
      },
    },
    props: {
      decorations(state) {
        return mermaidPreviewKey.getState(state) ?? DecorationSet.empty;
      },
    },
  });
}
