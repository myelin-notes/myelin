import {
  InputRule,
  inputRules,
  textblockTypeInputRule,
} from 'prosemirror-inputrules';
import type { Schema } from 'prosemirror-model';
import type { Plugin } from 'prosemirror-state';
import type { BlockPrefixMatch } from './types';

function getHeadingMatchType(match: RegExpMatchArray): BlockPrefixMatch {
  switch (match[1].length) {
    case 1:
      return 'h1';
    case 2:
      return 'h2';
    default:
      return 'h3';
  }
}

export function buildPrefixMarkdownRules(schema: Schema) {
  return [
    textblockTypeInputRule(/^(#{1,3})\s$/, schema.nodes.heading, (match) => {
      const matchType = getHeadingMatchType(match);
      const level = matchType === 'h1' ? 1 : matchType === 'h2' ? 2 : 3;
      return { level };
    }),
    textblockTypeInputRule(/^>\s$/, schema.nodes.blockquote),
    textblockTypeInputRule(/^[-*]\s$/, schema.nodes.bulletListItem),
    new InputRule(/^\[([ xX])\]\s$/, (state, match, start, end) => {
      const { $from } = state.selection;
      const node = $from.parent;
      if (node.type !== schema.nodes.bulletListItem) {
        return null;
      }
      return state.tr
        .delete(start, end)
        .setNodeMarkup($from.before(), schema.nodes.checkListItem, {
          checked: match[1].toLowerCase() === 'x',
          indent: node.attrs.indent ?? 0,
        });
    }),
    textblockTypeInputRule(
      /^(\d+)\.\s$/,
      schema.nodes.orderedListItem,
      (match) => ({ order: Number(match[1]) }),
    ),
  ];
}

export function prefixMarkdownInputRules(schema: Schema): Plugin {
  return inputRules({
    rules: buildPrefixMarkdownRules(schema),
  });
}
