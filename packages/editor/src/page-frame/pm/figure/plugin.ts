import type { Node as PMNode, Schema } from 'prosemirror-model';
import {
  type Command,
  Plugin,
  TextSelection,
  type Transaction,
} from 'prosemirror-state';
import { ySyncPluginKey } from 'y-prosemirror';
import { isPlainTextParagraph } from '../markdown/fence-commands';
import {
  collectAffectedTextblocks,
  getChangedRangesForTransactions,
} from '../markdown/range-tracking';
import { parseFigureSource } from './parse';

export function figureFromParagraph(
  paragraph: PMNode,
  schema: Schema,
): PMNode | null {
  if (!isPlainTextParagraph(paragraph, schema.nodes.paragraph)) {
    return null;
  }
  const source = parseFigureSource(paragraph.textContent);
  if (!source) {
    return null;
  }
  return schema.nodes.figure.create(
    { src: source.src, alt: source.alt },
    source.caption ? schema.text(source.caption) : null,
  );
}

function isRemote(transaction: Transaction): boolean {
  return transaction.getMeta(ySyncPluginKey)?.isChangeOrigin === true;
}

// A plugin rather than an input rule: media-path autocomplete completes the syntax programmatically.
export function figureMarkdownPlugin(schema: Schema): Plugin {
  return new Plugin({
    appendTransaction(transactions, oldState, newState) {
      // Each client converts its own edits; converting remote ones too would duplicate the figure.
      if (transactions.some(isRemote)) {
        return null;
      }
      const ranges = getChangedRangesForTransactions(
        transactions,
        newState.doc.content.size,
      );
      const { $from: $oldFrom } = oldState.selection;
      // Leaving a paragraph finishes it, when the caret sat mid-URL and held conversion back.
      if (
        ranges.length === 0 &&
        oldState.doc.eq(newState.doc) &&
        $oldFrom.depth === 1 &&
        !$oldFrom.sameParent(newState.selection.$from)
      ) {
        ranges.push({ from: $oldFrom.start(), to: $oldFrom.end() });
      }
      if (ranges.length === 0) {
        return null;
      }

      const tr = newState.tr;
      const targets = collectAffectedTextblocks(newState.doc, ranges);
      for (const { pos, node } of targets.reverse()) {
        if (newState.doc.resolve(pos).depth !== 0) {
          continue;
        }
        const figure = figureFromParagraph(node, schema);
        if (!figure) {
          continue;
        }
        const hadCaret =
          newState.selection.from > pos &&
          newState.selection.from < pos + node.nodeSize;
        // Mid-URL means still being edited, such as a just-accepted path autocomplete.
        if (hadCaret && newState.selection.from !== pos + node.nodeSize - 1) {
          continue;
        }
        tr.replaceWith(pos, pos + node.nodeSize, figure);
        if (hadCaret) {
          tr.setSelection(
            TextSelection.create(tr.doc, pos + figure.nodeSize - 1),
          );
        }
      }
      return tr.docChanged ? tr : null;
    },
  });
}

export const exitFigureCaption: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty || $from.parent.type !== state.schema.nodes.figure) {
    return false;
  }
  if (dispatch) {
    const after = $from.after();
    const tr = state.tr.insert(after, state.schema.nodes.paragraph.create());
    dispatch(
      tr.setSelection(TextSelection.create(tr.doc, after + 1)).scrollIntoView(),
    );
  }
  return true;
};

/** Backspace at the start of a caption removes the image and keeps the caption as a paragraph. */
export const removeFigureAtCaptionStart: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (
    !empty ||
    $from.parent.type !== state.schema.nodes.figure ||
    $from.parentOffset !== 0
  ) {
    return false;
  }
  if (dispatch) {
    const before = $from.before();
    const tr = state.tr.replaceWith(
      before,
      $from.after(),
      state.schema.nodes.paragraph.create(null, $from.parent.content),
    );
    dispatch(tr.setSelection(TextSelection.create(tr.doc, before + 1)));
  }
  return true;
};
