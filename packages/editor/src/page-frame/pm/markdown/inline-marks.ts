import { InputRule, inputRules } from 'prosemirror-inputrules';
import type { MarkType, Node as PMNode, Schema } from 'prosemirror-model';
import type { Plugin } from 'prosemirror-state';
import type { Transform } from 'prosemirror-transform';
import { parseInlineMarkdown } from './parse-inline';
import { buildTextOffsetMap } from './text-offset-map';
import {
  type InlinePreviewKind,
  type InlinePreviewRange,
  MARKDOWN_ATOM_CHAR,
} from './types';

const MARK_BY_KIND: Partial<Record<InlinePreviewKind, string>> = {
  bold: 'bold',
  italic: 'italic',
  inlineCode: 'code',
};

function markTypeFor(
  range: InlinePreviewRange,
  schema: Schema,
): MarkType | null {
  const name = MARK_BY_KIND[range.kind];
  return name ? schema.marks[name] : null;
}

// Inline code is literal: its `*` and backticks must not pair with delimiters outside it. Text and
// inline atoms are one character per position, so `text` indices are content offsets.
function maskInlineCode(node: PMNode, text: string, schema: Schema): string {
  let masked = text;
  node.forEach((child, offset) => {
    if (child.isText && schema.marks.code.isInSet(child.marks)) {
      masked =
        masked.slice(0, offset) +
        MARKDOWN_ATOM_CHAR.repeat(child.nodeSize) +
        masked.slice(offset + child.nodeSize);
    }
  });
  return masked;
}

function hasOpenMath(textBefore: string): boolean {
  return (textBefore.match(/(?<!\\)\$/g)?.length ?? 0) % 2 === 1;
}

// Typing `**x**` keeps no literal asterisks: the delimiters go and the text gets a real mark, the
// same as Cmd+B. Parsing reuses the inline grammar so `$a*b*c$` and note links stay untouched.
export function inlineMarkInputRules(schema: Schema): Plugin {
  return inputRules({
    rules: [
      new InputRule(/[*`]$/, (state, match, start, end) => {
        if (start !== end) {
          return null;
        }
        const $start = state.doc.resolve(start);
        if (schema.marks.code.isInSet(state.storedMarks ?? $start.marks())) {
          return null;
        }
        const map = buildTextOffsetMap($start.parent, $start.before());
        const text = maskInlineCode($start.parent, map.text, schema);
        const { posAt } = map;
        const caret = posAt.indexOf(start);
        const candidate = text.slice(0, caret) + match[0];
        const range = parseInlineMarkdown(candidate).ranges.find(
          (r) => r.close.to === candidate.length && MARK_BY_KIND[r.kind],
        );
        const markType = range && markTypeFor(range, schema);
        if (!(range && markType)) {
          return null;
        }
        // An unclosed `$` means a formula is still being typed: the parser can't see it as math yet.
        if (hasOpenMath(candidate.slice(0, range.open.from))) {
          return null;
        }

        const tr = state.tr.delete(posAt[range.close.from], start);
        tr.addMark(
          posAt[range.contentFrom],
          posAt[range.contentTo],
          markType.create(),
        );
        tr.delete(posAt[range.open.from], posAt[range.open.to]);
        return tr.removeStoredMark(markType);
      }),
    ],
  });
}

/** Rewrites literal `**x**`-style text in one textblock as marks. Ranges apply last to first. */
export function convertInlineMarkdownInBlock(
  tr: Transform,
  node: PMNode,
  pos: number,
  schema: Schema,
): void {
  const map = buildTextOffsetMap(node, pos);
  const text = maskInlineCode(node, map.text, schema);
  const { posAt } = map;
  if (!/[*`]/.test(text)) {
    return;
  }
  const ranges = parseInlineMarkdown(text)
    .ranges.filter((range) => MARK_BY_KIND[range.kind])
    .sort((a, b) => b.open.from - a.open.from);
  for (const range of ranges) {
    const markType = markTypeFor(range, schema);
    if (!markType) {
      continue;
    }
    tr.delete(posAt[range.close.from], posAt[range.close.to]);
    tr.addMark(
      posAt[range.contentFrom],
      posAt[range.contentTo],
      markType.create(),
    );
    tr.delete(posAt[range.open.from], posAt[range.open.to]);
  }
}
