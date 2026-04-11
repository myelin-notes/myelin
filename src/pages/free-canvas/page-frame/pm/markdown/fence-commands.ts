import { exitCode } from 'prosemirror-commands';
import { InputRule, inputRules } from 'prosemirror-inputrules';
import type { Schema } from 'prosemirror-model';
import type { Plugin } from 'prosemirror-state';
import { type Command, TextSelection } from 'prosemirror-state';
import { findFenceLineAtOffset, parseFenceMarkdown } from './parse-fences';

const FENCE = '```';
const OPEN_FENCE_TEXT = '```\n';

function buildOpenFenceInputRule(schema: Schema): InputRule {
  return new InputRule(/^```$/, (state, _match, start) => {
    const codeBlockType = schema.nodes.codeBlock;
    const paragraphType = schema.nodes.paragraph;
    const $start = state.doc.resolve(start);
    const paragraph = $start.parent;

    if (paragraph.type !== paragraphType || paragraph.textContent !== '``') {
      return null;
    }

    const parent = $start.node(-1);
    const index = $start.index(-1);
    if (!parent.canReplaceWith(index, index + 1, codeBlockType)) {
      return null;
    }

    const blockPos = $start.before();
    const codeBlock = codeBlockType.create(
      null,
      state.schema.text(OPEN_FENCE_TEXT),
    );
    let tr = state.tr.replaceWith(
      blockPos,
      blockPos + paragraph.nodeSize,
      codeBlock,
    );
    tr = tr.setSelection(
      TextSelection.create(tr.doc, blockPos + 1 + OPEN_FENCE_TEXT.length),
    );
    return tr.scrollIntoView();
  });
}

export function fenceMarkdownInputRules(schema: Schema): Plugin {
  return inputRules({
    rules: [buildOpenFenceInputRule(schema)],
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
  if (!line || line.kind !== 'closingFence' || line.text !== FENCE) {
    return false;
  }

  return exitCode(state, dispatch);
};
