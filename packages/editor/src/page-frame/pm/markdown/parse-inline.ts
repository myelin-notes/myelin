import {
  type InlinePreviewKind,
  type InlinePreviewRange,
  MARKDOWN_ATOM_CHAR,
  type ParsedInlineMarkdown,
} from './types';

function hasBarrier(text: string, from: number, to: number): boolean {
  return text.slice(from, to).includes(MARKDOWN_ATOM_CHAR);
}

function hasVisibleContent(text: string, from: number, to: number): boolean {
  if (from >= to) {
    return false;
  }
  return /\S/.test(text.slice(from, to));
}

function rangeHasBlocked(
  blocked: readonly boolean[],
  from: number,
  to: number,
): boolean {
  for (let i = from; i < to; i++) {
    if (blocked[i]) {
      return true;
    }
  }
  return false;
}

function markBlocked(blocked: boolean[], from: number, to: number): void {
  for (let i = from; i < to; i++) {
    blocked[i] = true;
  }
}

function isExactDelimiterRun(
  text: string,
  index: number,
  delimiter: string,
): boolean {
  if (!text.startsWith(delimiter, index)) {
    return false;
  }

  const char = delimiter[0];
  const before = index > 0 ? text[index - 1] : '';
  const after = text[index + delimiter.length] ?? '';
  return before !== char && after !== char;
}

function pushRange(
  ranges: InlinePreviewRange[],
  kind: InlinePreviewKind,
  openFrom: number,
  openTo: number,
  contentFrom: number,
  contentTo: number,
  closeFrom: number,
  closeTo: number,
): void {
  ranges.push({
    kind,
    contentFrom,
    contentTo,
    open: { from: openFrom, to: openTo },
    close: { from: closeFrom, to: closeTo },
  });
}

function parseInlineCode(
  text: string,
  blocked: boolean[],
  ranges: InlinePreviewRange[],
): void {
  for (let i = 0; i < text.length; i++) {
    if (blocked[i] || !isExactDelimiterRun(text, i, '`')) {
      continue;
    }

    let close = -1;
    for (let j = i + 1; j < text.length; j++) {
      if (blocked[j] || !isExactDelimiterRun(text, j, '`')) {
        continue;
      }
      close = j;
      break;
    }

    if (close === -1) {
      continue;
    }

    if (
      hasBarrier(text, i + 1, close) ||
      !hasVisibleContent(text, i + 1, close) ||
      rangeHasBlocked(blocked, i, close + 1)
    ) {
      continue;
    }

    pushRange(ranges, 'inlineCode', i, i + 1, i + 1, close, close, close + 1);
    markBlocked(blocked, i, close + 1);
    i = close;
  }
}

function parseDoubleBracketDelimited(
  text: string,
  blocked: boolean[],
  ranges: InlinePreviewRange[],
): void {
  for (let i = 0; i <= text.length - 2; i++) {
    if (rangeHasBlocked(blocked, i, i + 2)) {
      continue;
    }
    if (!isExactDelimiterRun(text, i, '[[')) {
      continue;
    }

    let close = -1;
    for (let j = i + 2; j <= text.length - 2; j++) {
      if (rangeHasBlocked(blocked, j, j + 2)) {
        continue;
      }
      if (!isExactDelimiterRun(text, j, ']]')) {
        continue;
      }
      close = j;
      break;
    }

    if (close === -1) {
      continue;
    }

    if (
      hasBarrier(text, i + 2, close) ||
      !hasVisibleContent(text, i + 2, close) ||
      rangeHasBlocked(blocked, i, close + 2)
    ) {
      continue;
    }

    pushRange(ranges, 'noteLink', i, i + 2, i + 2, close, close, close + 2);
    markBlocked(blocked, i, close + 2);
    i = close + 1;
  }
}

function isEscaped(text: string, index: number): boolean {
  return index > 0 && text[index - 1] === '\\';
}

function parseInlineMath(
  text: string,
  blocked: boolean[],
  ranges: InlinePreviewRange[],
): void {
  for (let i = 0; i < text.length; i++) {
    if (blocked[i] || text[i] !== '$' || isEscaped(text, i)) {
      continue;
    }

    // Not an opening delimiter: part of a `$$` run, or followed by
    // whitespace/another `$` (currency like "$ 5" or block math).
    const next = text[i + 1] ?? '';
    const prev = i > 0 ? text[i - 1] : '';
    if (prev === '$' || next === '$' || next === '' || /\s/.test(next)) {
      continue;
    }

    // The closing delimiter is the first unescaped `$` after the opening.
    // If that `$` is preceded by whitespace (e.g. "$5 and $10"), the whole
    // candidate is abandoned — math content may not contain a bare `$`.
    let close = -1;
    for (let j = i + 1; j < text.length; j++) {
      const char = text[j];
      if (char === '\n') {
        break;
      }
      if (char !== '$' || isEscaped(text, j)) {
        continue;
      }
      if (blocked[j] || /\s/.test(text[j - 1])) {
        break;
      }
      close = j;
      break;
    }

    if (close === -1) {
      continue;
    }

    if (
      hasBarrier(text, i + 1, close) ||
      !hasVisibleContent(text, i + 1, close) ||
      rangeHasBlocked(blocked, i, close + 1)
    ) {
      continue;
    }

    pushRange(ranges, 'math', i, i + 1, i + 1, close, close, close + 1);
    markBlocked(blocked, i, close + 1);
    i = close;
  }
}

function parseTripleAsteriskDelimited(
  text: string,
  blocked: boolean[],
  ranges: InlinePreviewRange[],
): void {
  for (let i = 0; i <= text.length - 3; i++) {
    if (rangeHasBlocked(blocked, i, i + 3)) {
      continue;
    }
    if (!isExactDelimiterRun(text, i, '***')) {
      continue;
    }

    let close = -1;
    for (let j = i + 3; j <= text.length - 3; j++) {
      if (rangeHasBlocked(blocked, j, j + 3)) {
        continue;
      }
      if (!isExactDelimiterRun(text, j, '***')) {
        continue;
      }
      close = j;
      break;
    }

    if (close === -1) {
      continue;
    }

    if (
      hasBarrier(text, i + 3, close) ||
      !hasVisibleContent(text, i + 3, close) ||
      rangeHasBlocked(blocked, i, close + 3)
    ) {
      continue;
    }

    // Match standard Markdown parsers such as `marked`, which interpret
    // `***text***` as <em><strong>text</strong></em>. Only the text content
    // should receive formatting; all three asterisks remain delimiters.
    pushRange(ranges, 'italic', i, i + 1, i + 3, close, close + 2, close + 3);
    pushRange(ranges, 'bold', i + 1, i + 3, i + 3, close, close, close + 2);
    markBlocked(blocked, i, close + 3);
    i = close + 2;
  }
}

function parseAsteriskDelimited(
  text: string,
  blocked: boolean[],
  ranges: InlinePreviewRange[],
  delimiter: '*' | '**',
  kind: InlinePreviewKind,
): void {
  const delimiterLength = delimiter.length;
  for (let i = 0; i <= text.length - delimiterLength; i++) {
    if (rangeHasBlocked(blocked, i, i + delimiterLength)) {
      continue;
    }
    if (!isExactDelimiterRun(text, i, delimiter)) {
      continue;
    }

    let close = -1;
    for (let j = i + delimiterLength; j <= text.length - delimiterLength; j++) {
      if (rangeHasBlocked(blocked, j, j + delimiterLength)) {
        continue;
      }
      if (!isExactDelimiterRun(text, j, delimiter)) {
        continue;
      }
      close = j;
      break;
    }

    if (close === -1) {
      continue;
    }

    if (
      hasBarrier(text, i + delimiterLength, close) ||
      !hasVisibleContent(text, i + delimiterLength, close) ||
      rangeHasBlocked(blocked, i, close + delimiterLength)
    ) {
      continue;
    }

    pushRange(
      ranges,
      kind,
      i,
      i + delimiterLength,
      i + delimiterLength,
      close,
      close,
      close + delimiterLength,
    );
    markBlocked(blocked, i, close + delimiterLength);
    i = close + delimiterLength - 1;
  }
}

export function parseInlineMarkdown(text: string): ParsedInlineMarkdown {
  const blocked = new Array<boolean>(text.length).fill(false);
  const ranges: InlinePreviewRange[] = [];

  parseInlineCode(text, blocked, ranges);
  parseDoubleBracketDelimited(text, blocked, ranges);
  parseInlineMath(text, blocked, ranges);
  parseTripleAsteriskDelimited(text, blocked, ranges);
  parseAsteriskDelimited(text, blocked, ranges, '**', 'bold');
  parseAsteriskDelimited(text, blocked, ranges, '*', 'italic');

  ranges.sort((a, b) => a.open.from - b.open.from);
  return { ranges };
}
