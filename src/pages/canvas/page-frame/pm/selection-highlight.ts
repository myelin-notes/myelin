import { Plugin } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';
import {
  CODE_BLOCK_EXTERNAL_SELECTION_EVENT,
  type CodeBlockExternalSelectionDetail,
} from './code-block-selection-sync';

const CODE_BLOCK_NODE_NAME = 'codeBlock';
const CODE_BLOCK_NODE_VIEW_SELECTOR = '.pm-monaco-code-block';

function dispatchExternalSelection(
  dom: HTMLElement,
  detail: CodeBlockExternalSelectionDetail,
): void {
  dom.dispatchEvent(
    new CustomEvent(CODE_BLOCK_EXTERNAL_SELECTION_EVENT, { detail }),
  );
}

function syncCodeBlockExternalSelections(view: EditorView): void {
  const active = new Set<HTMLElement>();
  const { from, to } = view.state.selection;

  if (from !== to) {
    view.state.doc.descendants((node, pos) => {
      if (node.type.name !== CODE_BLOCK_NODE_NAME) {
        return true;
      }

      const contentStart = pos + 1;
      const contentEnd = contentStart + node.content.size;
      if (to > contentStart && from < contentEnd) {
        const dom = view.nodeDOM(pos);
        if (dom instanceof HTMLElement) {
          active.add(dom);
          dispatchExternalSelection(dom, {
            from: Math.max(from, contentStart) - contentStart,
            to: Math.min(to, contentEnd) - contentStart,
          });
        }
      }

      return false;
    });
  }

  view.dom
    .querySelectorAll<HTMLElement>(CODE_BLOCK_NODE_VIEW_SELECTOR)
    .forEach((dom) => {
      if (!active.has(dom)) {
        dispatchExternalSelection(dom, null);
      }
    });
}

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
    view(editorView) {
      syncCodeBlockExternalSelections(editorView);
      return {
        update(view) {
          syncCodeBlockExternalSelections(view);
        },
        destroy() {
          editorView.dom
            .querySelectorAll<HTMLElement>(CODE_BLOCK_NODE_VIEW_SELECTOR)
            .forEach((dom) => {
              dispatchExternalSelection(dom, null);
            });
        },
      };
    },
  });
}
