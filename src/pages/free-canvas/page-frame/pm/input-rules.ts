import {
  InputRule,
  inputRules,
  textblockTypeInputRule,
  wrappingInputRule,
} from 'prosemirror-inputrules';
import type { MarkType, Schema } from 'prosemirror-model';
import { Plugin, PluginKey } from 'prosemirror-state';

/**
 * Build an input rule that wraps the captured group in a mark, removing the
 * delimiter characters from both sides. The regex must:
 *   - capture the inner text (without delimiters) in group 1
 *   - end with `$` so it fires the moment the closing delimiter is typed
 *
 * `delim` is the literal opening delimiter string (e.g. `**`, `*`, `` ` ``,
 * `~~`). It is used to locate the delimiter inside the matched text, which
 * lets the regex include a leading non-delimiter context character — needed
 * to disambiguate `**bold**` from `*italic*` — without breaking the math.
 */
function markInputRule(
  regexp: RegExp,
  markType: MarkType,
  delim: string,
): InputRule {
  return new InputRule(regexp, (state, match, start, end) => {
    const captured = match[1];
    if (!captured) {
      return null;
    }

    // Bail out in nodes that don't allow this mark (e.g. code blocks).
    const $start = state.doc.resolve(start);
    if (!$start.parent.type.allowsMarkType(markType)) {
      return null;
    }

    // Locate the opening delimiter inside the full match. The regex may have
    // consumed a leading context char (`(?:^|[^*])`), so the delimiter isn't
    // necessarily at offset 0 of match[0].
    const openOffset = match[0].indexOf(delim);
    if (openOffset < 0) {
      return null;
    }
    const openDelimStart = start + openOffset;
    const captureStart = openDelimStart + delim.length;
    const captureEnd = captureStart + captured.length;

    // If the captured range is already marked, do nothing.
    if (state.doc.rangeHasMark(captureStart, captureEnd, markType)) {
      return null;
    }

    const tr = state.tr;
    // Delete closing first so the earlier positions remain valid.
    tr.delete(captureEnd, end);
    tr.delete(openDelimStart, captureStart);
    tr.addMark(
      openDelimStart,
      openDelimStart + captured.length,
      markType.create(),
    );
    // Don't carry the mark forward to the next typed character.
    tr.removeStoredMark(markType);
    return tr;
  });
}

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

      // Inline mark rules. Order matters — bold (`**`) must be tried before
      // italic (`*`) so the second `*` of a closing pair doesn't fire italic
      // first. The leading `(?:^|[^*])` keeps stray `*` characters elsewhere
      // in the line from accidentally anchoring an italic match.
      markInputRule(/(?:^|[^*])\*\*([^*\n]+)\*\*$/, s.marks.bold, '**'),
      markInputRule(/(?:^|[^*])\*([^*\n]+)\*$/, s.marks.italic, '*'),
      markInputRule(/`([^`\n]+)`$/, s.marks.code, '`'),
      markInputRule(/~~([^~\n]+)~~$/, s.marks.strikethrough, '~~'),
    ],
  });
}

const autoFormatKey = new PluginKey('inlineMarkAutoFormat');

interface DelimSpec {
  delim: string;
  markType: MarkType;
}

/**
 * The end-anchored input rules above only fire when the user types the
 * closing delimiter LAST. This plugin handles the other common flow:
 * the user types both delimiters first (e.g. `` ` ` ``), moves the cursor
 * between them, and then types content. After each typed character we look
 * for a `delim…content…delim` pattern straddling the cursor and, if we find
 * one, apply the mark and strip the delimiters. PM's normal stored-marks
 * behavior then carries the mark forward to subsequent typed characters.
 */
export function inlineMarkAutoFormatPlugin(s: Schema): Plugin {
  // Longest delimiter first so `**` is tested before `*`, and `~~` before
  // any future single-`~` rule.
  const specs: DelimSpec[] = [
    { delim: '**', markType: s.marks.bold },
    { delim: '~~', markType: s.marks.strikethrough },
    { delim: '*', markType: s.marks.italic },
    { delim: '`', markType: s.marks.code },
  ];

  return new Plugin({
    key: autoFormatKey,
    appendTransaction(transactions, _oldState, newState) {
      // Only react to user-driven doc changes — and never to our own
      // generated transactions, to avoid re-entrant loops.
      const userChange = transactions.some(
        (tr) => tr.docChanged && !tr.getMeta(autoFormatKey),
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

      // textBetween joins the parent's inline content with `\ufffc` placeholders
      // for non-text children, so character offsets stay aligned with PM positions.
      const text = parent.textBetween(
        0,
        parent.content.size,
        undefined,
        '\ufffc',
      );
      const blockStart = $cursor.start();
      const cursorOffset = $cursor.parentOffset;

      for (const { delim, markType } of specs) {
        if (!parent.type.allowsMarkType(markType)) {
          continue;
        }

        // Closing delimiter at-or-after cursor.
        const closeIdx = text.indexOf(delim, cursorOffset);
        if (closeIdx < 0) {
          continue;
        }
        // Opening delimiter that ends at-or-before cursor.
        const openIdx = text.lastIndexOf(delim, cursorOffset - delim.length);
        if (openIdx < 0 || openIdx + delim.length > cursorOffset) {
          continue;
        }

        const contentStart = openIdx + delim.length;
        const contentEnd = closeIdx;
        if (contentStart >= contentEnd) {
          continue;
        }

        const inner = text.slice(contentStart, contentEnd);
        // Refuse if the inner spans the delimiter, a newline, or a non-text
        // marker — those would mean the user isn't really inside a clean pair.
        if (
          inner.includes(delim) ||
          inner.includes('\n') ||
          inner.includes('\ufffc')
        ) {
          continue;
        }

        const docContentStart = blockStart + contentStart;
        const docContentEnd = blockStart + contentEnd;

        // Already marked? Nothing to do.
        if (
          newState.doc.rangeHasMark(docContentStart, docContentEnd, markType)
        ) {
          continue;
        }

        const tr = newState.tr;
        tr.addMark(docContentStart, docContentEnd, markType.create());
        // Delete closing delim first so the lower positions stay valid.
        tr.delete(
          blockStart + closeIdx,
          blockStart + closeIdx + delim.length,
        );
        tr.delete(
          blockStart + openIdx,
          blockStart + openIdx + delim.length,
        );
        tr.setMeta(autoFormatKey, true);
        return tr;
      }

      // No auto-format pattern matched. Defensive: if the cursor's parent
      // block is empty (i.e. the user just deleted the entire marked
      // section) but storedMarks somehow persisted, clear them so the next
      // typed character starts fresh. This is normally a no-op (PM's
      // `addStep` clears `tr.storedMarks` automatically), but covers any
      // edge case where stored marks linger after the block is empty.
      if (
        $cursor.parent.content.size === 0 &&
        newState.storedMarks &&
        newState.storedMarks.length > 0
      ) {
        return newState.tr.setStoredMarks(null);
      }

      return null;
    },
  });
}
