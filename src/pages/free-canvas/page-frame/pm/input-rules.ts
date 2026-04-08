import type { MarkType, NodeType, Schema } from 'prosemirror-model';
import { Plugin, PluginKey } from 'prosemirror-state';

const markdownKey = new PluginKey('markdownAutoFormat');

interface InlineSpec {
  delim: string;
  markType: MarkType;
}

interface BlockSpec {
  prefix: string;
  nodeType: NodeType;
  attrs?: Record<string, unknown>;
}

/**
 * Markdown auto-format. After every user-driven text change we scan the
 * parent textblock for markdown patterns and apply formatting WITHOUT
 * consuming the delimiter characters. The delimiters get the `mdDelim`
 * mark, which renders them visually muted via CSS — so the user can still
 * see, edit, and delete them like normal text.
 *
 *   inline: **bold**, *italic*, `code`, ~~strikethrough~~
 *   block:  `# `, `## `, `### ` (headings) and `` ``` `` (code block)
 *
 * Block conversion fires when the text BEFORE the cursor exactly equals one
 * of the prefix patterns — same trigger as PM's textblockTypeInputRule, just
 * without the destructive `tr.delete` call that strips the prefix.
 */
export function markdownAutoFormatPlugin(s: Schema): Plugin {
  // Longer delimiters first so `**` is tested before `*`, and `~~` before
  // any future single-`~` rule.
  const inlineSpecs: InlineSpec[] = [
    { delim: '**', markType: s.marks.bold },
    { delim: '~~', markType: s.marks.strikethrough },
    { delim: '*', markType: s.marks.italic },
    { delim: '`', markType: s.marks.code },
  ];

  // Longer prefixes first so `### ` beats `## ` beats `# `.
  const blockSpecs: BlockSpec[] = [
    { prefix: '### ', nodeType: s.nodes.heading, attrs: { level: 3 } },
    { prefix: '## ', nodeType: s.nodes.heading, attrs: { level: 2 } },
    { prefix: '# ', nodeType: s.nodes.heading, attrs: { level: 1 } },
    { prefix: '```', nodeType: s.nodes.codeBlock },
  ];

  const delimMark = s.marks.mdDelim;

  return new Plugin({
    key: markdownKey,
    appendTransaction(transactions, _oldState, newState) {
      // Only react to user-driven doc changes — never to our own generated
      // transactions, to avoid re-entrant loops.
      const userChange = transactions.some(
        (tr) => tr.docChanged && !tr.getMeta(markdownKey),
      );
      if (!userChange) {
        return null;
      }

      const { selection } = newState;
      if (!selection.empty) {
        return null;
      }

      const $cursor = selection.$from;
      const parent = $cursor.parent;
      if (!parent.isTextblock) {
        return null;
      }

      const blockStart = $cursor.start();
      const cursorOffset = $cursor.parentOffset;
      // textBetween joins inline content with `\ufffc` placeholders for
      // non-text children, so character offsets stay aligned with PM
      // positions.
      const text = parent.textBetween(
        0,
        parent.content.size,
        undefined,
        '\ufffc',
      );

      // 1. Block-type conversion. Only convert plain paragraphs whose
      // text-before-cursor exactly matches one of the prefixes. Anchoring on
      // the cursor (instead of a substring match) means subsequent typing in
      // the converted block doesn't keep re-firing the rule.
      if (parent.type === s.nodes.paragraph) {
        const before = text.slice(0, cursorOffset);
        for (const { prefix, nodeType, attrs } of blockSpecs) {
          if (before !== prefix) {
            continue;
          }
          const tr = newState.tr;
          // codeBlock only allows the `mdDelim` mark — strip every other
          // mark from the existing inline content before the type swap,
          // otherwise setBlockType produces a doc that violates the schema.
          if (nodeType === s.nodes.codeBlock) {
            tr.removeMark(blockStart, blockStart + parent.content.size, null);
          }
          tr.setBlockType(blockStart, blockStart, nodeType, attrs);
          if (delimMark) {
            tr.addMark(
              blockStart,
              blockStart + prefix.length,
              delimMark.create(),
            );
          }
          tr.setMeta(markdownKey, true);
          return tr;
        }
      }

      // 2. Inline marks. Scan the parent text for any complete
      // `delim…content…delim` pairs that aren't already marked, and apply
      // both the formatting mark to the inner content and `mdDelim` to the
      // surrounding delimiters. Multiple pairs are batched into one
      // transaction so e.g. typing `**bold** *italic*` in one go marks both.
      const tr = newState.tr;
      let modified = false;

      for (const { delim, markType } of inlineSpecs) {
        if (!parent.type.allowsMarkType(markType)) {
          continue;
        }

        let searchFrom = 0;
        while (searchFrom < text.length) {
          const openIdx = text.indexOf(delim, searchFrom);
          if (openIdx < 0) {
            break;
          }
          const closeIdx = text.indexOf(delim, openIdx + delim.length);
          if (closeIdx < 0) {
            break;
          }

          const contentStart = openIdx + delim.length;
          const contentEnd = closeIdx;
          // Empty pair (e.g. `**` immediately followed by another `**`).
          // Skip past the closing delim and keep scanning.
          if (contentStart >= contentEnd) {
            searchFrom = closeIdx + delim.length;
            continue;
          }

          const inner = text.slice(contentStart, contentEnd);
          // Refuse if the inner spans a newline or non-text marker — that
          // would mean we're not really inside a clean pair.
          if (inner.includes('\n') || inner.includes('\ufffc')) {
            searchFrom = closeIdx + delim.length;
            continue;
          }

          const docContentStart = blockStart + contentStart;
          const docContentEnd = blockStart + contentEnd;
          // Already formatted? Nothing to do for this pair.
          if (
            newState.doc.rangeHasMark(docContentStart, docContentEnd, markType)
          ) {
            searchFrom = closeIdx + delim.length;
            continue;
          }

          tr.addMark(docContentStart, docContentEnd, markType.create());
          if (delimMark) {
            tr.addMark(
              blockStart + openIdx,
              blockStart + contentStart,
              delimMark.create(),
            );
            tr.addMark(
              blockStart + closeIdx,
              blockStart + closeIdx + delim.length,
              delimMark.create(),
            );
          }
          modified = true;
          searchFrom = closeIdx + delim.length;
        }
      }

      if (modified) {
        tr.setMeta(markdownKey, true);
        return tr;
      }
      return null;
    },
  });
}
