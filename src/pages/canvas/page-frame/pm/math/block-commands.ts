import { exitCode } from 'prosemirror-commands';
import { InputRule, inputRules } from 'prosemirror-inputrules';
import { Fragment, type Node as PMNode, type Schema } from 'prosemirror-model';
import type { Plugin } from 'prosemirror-state';
import {
  type Command,
  Plugin as StatePlugin,
  TextSelection,
} from 'prosemirror-state';
import {
  buildParagraphsFromCodeText,
  type InvalidFenceReplacement,
  isPlainTextParagraph,
  mapSelectionPointAfterFenceReplacement,
} from '../markdown/fence-commands';
import { findFenceLineAtOffset } from '../markdown/parse-fences';
import {
  type ChangedRange,
  collectAffectedTextblocks,
  getChangedRangesForTransactions,
} from '../markdown/range-tracking';
import { isMathFenceLine, parseMathMarkdown } from './parse-math-block';

/**
 * Enter on a paragraph containing exactly `$$` opens a math block with an
 * empty content line and the cursor on it.
 */
export const openMathBlockOnEnter: Command = (state, dispatch) => {
  const { empty, $from } = state.selection;
  const { mathBlock, paragraph } = state.schema.nodes;
  if (
    !empty ||
    $from.parent.type !== paragraph ||
    $from.parent.textContent !== '$$' ||
    !isPlainTextParagraph($from.parent, paragraph)
  ) {
    return false;
  }

  const blockStart = $from.before();
  const blockEnd = $from.after();
  const parentDepth = $from.depth - 1;
  const index = $from.index(parentDepth);
  if (!$from.node(parentDepth).canReplaceWith(index, index + 1, mathBlock)) {
    return false;
  }

  if (dispatch) {
    const text = '$$\n\n$$';
    const node = mathBlock.create(null, state.schema.text(text));
    let tr = state.tr.replaceWith(blockStart, blockEnd, node);
    // Cursor on the empty content line between the fences.
    tr = tr.setSelection(TextSelection.create(tr.doc, blockStart + 1 + 3));
    dispatch(tr.scrollIntoView());
  }
  return true;
};

function buildClosedMathInputRule(schema: Schema): InputRule {
  return new InputRule(/^\$\$$/, (state, _match, start) => {
    const mathBlockType = schema.nodes.mathBlock;
    const paragraphType = schema.nodes.paragraph;
    const $start = state.doc.resolve(start);
    const closingParagraph = $start.parent;

    if (
      closingParagraph.type !== paragraphType ||
      closingParagraph.textContent !== '$'
    ) {
      return null;
    }

    const parentDepth = $start.depth - 1;
    if (parentDepth < 0) {
      return null;
    }

    const parent = $start.node(parentDepth);
    const closingIndex = $start.index(parentDepth);
    let blockStartPos = $start.before();
    let openingIndex = -1;

    for (let index = closingIndex - 1; index >= 0; index--) {
      const sibling = parent.child(index);
      blockStartPos -= sibling.nodeSize;

      if (!isPlainTextParagraph(sibling, paragraphType)) {
        return null;
      }

      if (isMathFenceLine(sibling.textContent)) {
        openingIndex = index;
        break;
      }
    }

    if (openingIndex === -1) {
      return null;
    }

    const blockEndPos = $start.before() + closingParagraph.nodeSize;
    const lines: string[] = [];
    for (let index = openingIndex; index <= closingIndex; index++) {
      const sibling = parent.child(index);
      if (!isPlainTextParagraph(sibling, paragraphType)) {
        return null;
      }

      lines.push(index === closingIndex ? '$$' : sibling.textContent);
    }

    if (!parent.canReplaceWith(openingIndex, closingIndex + 1, mathBlockType)) {
      return null;
    }

    const mathText = lines.join('\n');
    const mathNode = mathBlockType.create(null, state.schema.text(mathText));
    let tr = state.tr.replaceWith(blockStartPos, blockEndPos, mathNode);
    tr = tr.setSelection(
      TextSelection.create(tr.doc, blockStartPos + 1 + mathText.length),
    );
    return tr.scrollIntoView();
  });
}

export function mathBlockInputRules(schema: Schema): Plugin {
  return inputRules({
    rules: [buildClosedMathInputRule(schema)],
  });
}

function collectInvalidMathReplacements(
  doc: PMNode,
  schema: Schema,
  ranges: ChangedRange[],
): InvalidFenceReplacement[] {
  return collectAffectedTextblocks(
    doc,
    ranges,
    (node) => node.type === schema.nodes.mathBlock,
  )
    .filter(({ node }) => {
      const parsed = parseMathMarkdown(node.textContent);
      return !(parsed.hasOpeningFence && parsed.hasClosingFence);
    })
    .map(({ pos, node }) => ({
      from: pos,
      to: pos + node.nodeSize,
      node,
    }));
}

export function mathBlockNormalizationPlugin(schema: Schema): Plugin {
  return new StatePlugin({
    appendTransaction(transactions, _oldState, newState) {
      const changedRanges = getChangedRangesForTransactions(
        transactions,
        newState.doc.content.size,
      );
      if (changedRanges.length === 0) {
        return null;
      }

      const target = collectInvalidMathReplacements(
        newState.doc,
        schema,
        changedRanges,
      )[0];
      if (!target) {
        return null;
      }

      const paragraphs = buildParagraphsFromCodeText(
        schema,
        target.node.textContent,
      );
      const tr = newState.tr.replaceWith(
        target.from,
        target.to,
        Fragment.fromArray(paragraphs),
      );
      const mappedAnchor = mapSelectionPointAfterFenceReplacement(
        newState.selection.anchor,
        target,
        tr,
      );
      const mappedHead = mapSelectionPointAfterFenceReplacement(
        newState.selection.head,
        target,
        tr,
      );
      tr.setSelection(
        TextSelection.between(
          tr.doc.resolve(mappedAnchor),
          tr.doc.resolve(mappedHead),
        ),
      );
      return tr;
    },
  });
}

export const exitMathBlock: Command = (state, dispatch) => {
  const { empty, $from, $to } = state.selection;
  if (
    !empty ||
    !$from.sameParent($to) ||
    $from.parent.type !== state.schema.nodes.mathBlock
  ) {
    return false;
  }

  const parsed = parseMathMarkdown($from.parent.textContent);
  if (!parsed.hasOpeningFence || !parsed.closingFence) {
    return false;
  }

  const line = findFenceLineAtOffset(parsed, $from.parentOffset);
  if (!line || line.kind !== 'closingFence') {
    return false;
  }

  return exitCode(state, dispatch);
};
