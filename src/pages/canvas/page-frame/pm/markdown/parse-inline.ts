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
  parseTripleAsteriskDelimited(text, blocked, ranges);
  parseAsteriskDelimited(text, blocked, ranges, '**', 'bold');
  parseAsteriskDelimited(text, blocked, ranges, '*', 'italic');

  ranges.sort((a, b) => a.open.from - b.open.from);
  return { ranges };
}
