import { exitCode } from 'prosemirror-commands';
import { InputRule, inputRules } from 'prosemirror-inputrules';
import { Fragment, type Node as PMNode, type Schema } from 'prosemirror-model';
import type { Plugin, Transaction } from 'prosemirror-state';
import {
  type Command,
  Plugin as StatePlugin,
  TextSelection,
} from 'prosemirror-state';
import {
  findFenceLineAtOffset,
  isClosingFenceLine,
  isOpeningFenceLine,
  parseFenceMarkdown,
} from './parse-fences';
import {
  collectAffectedTextblocks,
  getChangedRangesForTransactions,
} from './range-tracking';

function isPlainTextParagraph(
  node: PMNode,
  paragraphType: PMNode['type'],
): boolean {
  if (node.type !== paragraphType) {
    return false;
  }

  let hasOnlyTextChildren = true;
  node.forEach((child) => {
    if (!child.isText) {
      hasOnlyTextChildren = false;
    }
  });
  return hasOnlyTextChildren;
}

function buildClosedFenceInputRule(schema: Schema): InputRule {
  return new InputRule(/^```$/, (state, _match, start) => {
    const codeBlockType = schema.nodes.codeBlock;
    const paragraphType = schema.nodes.paragraph;
    const $start = state.doc.resolve(start);
    const closingParagraph = $start.parent;

    if (
      closingParagraph.type !== paragraphType ||
      closingParagraph.textContent !== '``'
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

      if (isOpeningFenceLine(sibling.textContent)) {
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

      lines.push(index === closingIndex ? '```' : sibling.textContent);
    }

    if (!parent.canReplaceWith(openingIndex, closingIndex + 1, codeBlockType)) {
      return null;
    }

    const codeText = lines.join('\n');
    const codeBlock = codeBlockType.create(null, state.schema.text(codeText));
    let tr = state.tr.replaceWith(blockStartPos, blockEndPos, codeBlock);
    tr = tr.setSelection(
      TextSelection.create(tr.doc, blockStartPos + 1 + codeText.length),
    );
    return tr.scrollIntoView();
  });
}

export function fenceMarkdownInputRules(schema: Schema): Plugin {
  return inputRules({
    rules: [buildClosedFenceInputRule(schema)],
  });
}

function buildParagraphsFromCodeText(schema: Schema, text: string): PMNode[] {
  const paragraphType = schema.nodes.paragraph;
  const lines = text.split('\n');
  const normalizedLines = lines.length > 0 ? lines : [''];

  return normalizedLines.map((line) =>
    line.length > 0
      ? paragraphType.create(null, schema.text(line))
      : paragraphType.create(),
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function mapCodeTextOffsetToParagraphSelection(
  blockPos: number,
  text: string,
  offset: number,
): number {
  const lines = text.split('\n');
  const normalizedLines = lines.length > 0 ? lines : [''];
  let remaining = clamp(offset, 0, text.length);
  let paragraphPos = blockPos;
  let fallback = blockPos + 1;

  for (let index = 0; index < normalizedLines.length; index++) {
    const line = normalizedLines[index];
    const textStart = paragraphPos + 1;
    const textEnd = textStart + line.length;
    fallback = textEnd;

    if (remaining <= line.length) {
      return textStart + remaining;
    }

    remaining -= line.length;
    paragraphPos += line.length + 2;

    if (index < normalizedLines.length - 1) {
      remaining = Math.max(0, remaining - 1);
    }
  }

  return fallback;
}

function mapSelectionPointThroughFenceReplacement(
  selectionPos: number,
  target: InvalidFenceReplacement,
): number {
  const textStart = target.from + 1;
  const textEnd = target.to - 1;
  const offset = clamp(selectionPos, textStart, textEnd) - textStart;
  return mapCodeTextOffsetToParagraphSelection(
    target.from,
    target.node.textContent,
    offset,
  );
}

function mapSelectionPointAfterFenceReplacement(
  selectionPos: number,
  target: InvalidFenceReplacement,
  tr: Transaction,
): number {
  const textStart = target.from + 1;
  const textEnd = target.to - 1;
  if (selectionPos >= textStart && selectionPos <= textEnd) {
    return mapSelectionPointThroughFenceReplacement(selectionPos, target);
  }
  return tr.mapping.map(selectionPos);
}

interface InvalidFenceReplacement {
  from: number;
  to: number;
  node: PMNode;
}

function findInvalidFenceReplacement(
  targets: readonly InvalidFenceReplacement[],
): InvalidFenceReplacement | null {
  return targets[0] ?? null;
}

function collectInvalidFenceReplacements(
  doc: PMNode,
  schema: Schema,
  ranges: ReturnType<typeof getChangedRangesForTransactions>,
): InvalidFenceReplacement[] {
  return collectAffectedTextblocks(
    doc,
    ranges,
    (node) => node.type === schema.nodes.codeBlock,
  )
    .filter(({ node }) => {
      const parsed = parseFenceMarkdown(node.textContent);
      return !(parsed.hasOpeningFence && parsed.hasClosingFence);
    })
    .map(({ pos, node }) => ({
      from: pos,
      to: pos + node.nodeSize,
      node,
    }));
}

export function fenceMarkdownNormalizationPlugin(schema: Schema): Plugin {
  return new StatePlugin({
    appendTransaction(transactions, _oldState, newState) {
      const changedRanges = getChangedRangesForTransactions(
        transactions,
        newState.doc.content.size,
      );
      if (changedRanges.length === 0) {
        return null;
      }

      const target = findInvalidFenceReplacement(
        collectInvalidFenceReplacements(newState.doc, schema, changedRanges),
      );
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

export const exitFencedCodeBlock: Command = (state, dispatch) => {
  const { empty, $from, $to } = state.selection;
  if (!empty || !$from.sameParent($to) || !$from.parent.type.spec.code) {
    return false;
  }

  const parsed = parseFenceMarkdown($from.parent.textContent);
  if (!parsed.hasOpeningFence || !parsed.closingFence) {
    return false;
  }

  const line = findFenceLineAtOffset(parsed, $from.parentOffset);
  if (!line || line.kind !== 'closingFence' || !isClosingFenceLine(line.text)) {
    return false;
  }

  return exitCode(state, dispatch);
};
