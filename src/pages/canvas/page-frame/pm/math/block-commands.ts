import { exitCode } from 'prosemirror-commands';
import { InputRule, inputRules } from 'prosemirror-inputrules';
import type { Schema } from 'prosemirror-model';
import type { Plugin } from 'prosemirror-state';
import { type Command, TextSelection } from 'prosemirror-state';
import {
  buildNormalizationPlugin,
  isPlainTextParagraph,
} from '../markdown/fence-commands';
import { findFenceLineAtOffset } from '../markdown/parse-fences';
import {
  isMathFenceLine,
  parseMathMarkdown,
  SINGLE_LINE_MATH_BLOCK_RE,
} from './parse-math-block';

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

/**
 * Converts a single-line `$$...$$` paragraph into a math block the moment the
 * final `$` is typed. This mirrors the markdown importer, which canonicalizes
 * single-line block math into the multi-line form (`$$\n...\n$$`); without this
 * rule such math stays plain text in the live editor until a save/reload.
 *
 * At input-rule time the typed `$` is not in the doc yet, so the paragraph's
 * text is `$$...$` while the match text (`match[0]`) is the full `$$...$$`.
 */
function buildSingleLineMathInputRule(schema: Schema): InputRule {
  return new InputRule(SINGLE_LINE_MATH_BLOCK_RE, (state, match, start) => {
    const mathBlockType = schema.nodes.mathBlock;
    const paragraphType = schema.nodes.paragraph;
    const content = match[1];

    const $start = state.doc.resolve(start);
    const paragraph = $start.parent;
    if (!isPlainTextParagraph(paragraph, paragraphType)) {
      return null;
    }

    // The match must span the whole paragraph with the typed `$` landing at
    // its end — otherwise text after the cursor would be replaced away.
    if (paragraph.textContent !== match[0].slice(0, -1)) {
      return null;
    }

    const parentDepth = $start.depth - 1;
    if (parentDepth < 0) {
      return null;
    }

    const parent = $start.node(parentDepth);
    const index = $start.index(parentDepth);
    if (!parent.canReplaceWith(index, index + 1, mathBlockType)) {
      return null;
    }

    const blockStartPos = $start.before();
    const blockEndPos = blockStartPos + paragraph.nodeSize;
    const mathText = `$$\n${content}\n$$`;
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
    rules: [
      buildClosedMathInputRule(schema),
      buildSingleLineMathInputRule(schema),
    ],
  });
}

export function mathBlockNormalizationPlugin(schema: Schema): Plugin {
  return buildNormalizationPlugin(
    schema,
    (node) => node.type === schema.nodes.mathBlock,
    parseMathMarkdown,
  );
}

/**
 * Mod-A inside a math block selects the block's LaTeX content (between the
 * `$$` fences) instead of the whole document, so the raw-source editor feels
 * self-contained like a code block. The fences stay unselected so typing over
 * the selection replaces the formula without dissolving the block.
 */
export const selectAllInMathBlock: Command = (state, dispatch) => {
  const { $from, $to } = state.selection;
  if (
    !$from.sameParent($to) ||
    $from.parent.type !== state.schema.nodes.mathBlock
  ) {
    return false;
  }

  const blockStart = $from.start();
  const contentLines = parseMathMarkdown($from.parent.textContent).lines.filter(
    (line) => line.kind === 'content',
  );
  const first = contentLines[0];
  const last = contentLines[contentLines.length - 1];
  const selection =
    first && last
      ? TextSelection.create(
          state.doc,
          blockStart + first.from,
          blockStart + last.to,
        )
      : TextSelection.create(state.doc, blockStart, $from.end());
  dispatch?.(state.tr.setSelection(selection));
  return true;
};

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
