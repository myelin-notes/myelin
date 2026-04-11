import {
  inputRules,
  textblockTypeInputRule,
  wrappingInputRule,
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
    wrappingInputRule(/^>\s$/, schema.nodes.blockquote),
  ];
}

export function prefixMarkdownInputRules(schema: Schema): Plugin {
  return inputRules({
    rules: buildPrefixMarkdownRules(schema),
  });
}
