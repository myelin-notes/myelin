import {
  inputRules,
  textblockTypeInputRule,
  wrappingInputRule,
} from 'prosemirror-inputrules';
import type { Schema } from 'prosemirror-model';

export function buildInputRules(s: Schema) {
  return inputRules({
    rules: [
      // # Heading 1
      textblockTypeInputRule(/^#\s$/, s.nodes.heading, { level: 1 }),
      // ## Heading 2
      textblockTypeInputRule(/^##\s$/, s.nodes.heading, { level: 2 }),
      // ### Heading 3
      textblockTypeInputRule(/^###\s$/, s.nodes.heading, { level: 3 }),
      // - Bullet list
      wrappingInputRule(/^\s*[-*]\s$/, s.nodes.bulletList),
      // 1. Ordered list
      wrappingInputRule(
        /^\s*(\d+)\.\s$/,
        s.nodes.orderedList,
        (match) => ({ start: Number(match[1]) }),
        (match, node) =>
          node.childCount + node.attrs.start === Number(match[1]),
      ),
      // > Blockquote
      wrappingInputRule(/^\s*>\s$/, s.nodes.blockquote),
      // ``` Code block
      textblockTypeInputRule(/^```$/, s.nodes.codeBlock),
    ],
  });
}
