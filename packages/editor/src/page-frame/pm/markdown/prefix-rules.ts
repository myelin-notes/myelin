import { InputRule, inputRules } from 'prosemirror-inputrules';
import type { Attrs, NodeType, Schema } from 'prosemirror-model';
import type { Plugin } from 'prosemirror-state';
import type { BlockPrefixMatch } from './types';

function paragraphTypeInputRule(
  pattern: RegExp,
  type: NodeType,
  getAttrs?: (match: RegExpMatchArray) => Attrs,
): InputRule {
  return new InputRule(pattern, (state, match, start, end) => {
    const $start = state.doc.resolve(start);
    if (
      $start.parent.type !== type.schema.nodes.paragraph ||
      !$start
        .node(-1)
        .canReplaceWith($start.index(-1), $start.indexAfter(-1), type)
    ) {
      return null;
    }
    return state.tr
      .delete(start, end)
      .setBlockType(start, start, type, getAttrs?.(match));
  });
}

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
    paragraphTypeInputRule(/^(#{1,3})\s$/, schema.nodes.heading, (match) => {
      const matchType = getHeadingMatchType(match);
      const level = matchType === 'h1' ? 1 : matchType === 'h2' ? 2 : 3;
      return { level };
    }),
    paragraphTypeInputRule(/^>\s$/, schema.nodes.blockquote),
    paragraphTypeInputRule(/^[-*]\s$/, schema.nodes.bulletListItem),
    paragraphTypeInputRule(
      /^(\d+)\.\s$/,
      schema.nodes.orderedListItem,
      (match) => ({ order: Number(match[1]) }),
    ),
    new InputRule(/^\[([ xX]?)\]\s$/, (state, match, start, end) => {
      const { $from } = state.selection;
      const node = $from.parent;
      if (
        node.type !== schema.nodes.paragraph &&
        node.type !== schema.nodes.bulletListItem
      ) {
        return null;
      }
      return state.tr
        .delete(start, end)
        .setNodeMarkup($from.before(), schema.nodes.checkListItem, {
          checked: match[1].toLowerCase() === 'x',
          indent: node.attrs.indent ?? 0,
        });
    }),
  ];
}

export function prefixMarkdownInputRules(schema: Schema): Plugin {
  return inputRules({
    rules: buildPrefixMarkdownRules(schema),
  });
}
