import type { FenceLine, ParsedFenceMarkdown } from './types';

const FENCE = '```';

function splitLines(text: string): Omit<FenceLine, 'kind'>[] {
  if (text.length === 0) {
    return [];
  }

  const lines: Omit<FenceLine, 'kind'>[] = [];
  let start = 0;

  for (let i = 0; i <= text.length; i++) {
    const atEnd = i === text.length;
    const atNewline = text[i] === '\n';
    if (!atEnd && !atNewline) {
      continue;
    }

    const lineEnd = i;
    const fullEnd = atNewline ? i + 1 : i;
    lines.push({
      text: text.slice(start, lineEnd),
      from: start,
      to: lineEnd,
      fullFrom: start,
      fullTo: fullEnd,
    });
    start = i + 1;
  }

  return lines;
}

export function parseFenceMarkdown(text: string): ParsedFenceMarkdown {
  const rawLines = splitLines(text);
  if (rawLines.length === 0) {
    return {
      hasOpeningFence: false,
      hasClosingFence: false,
      lines: [],
      closingFence: null,
    };
  }

  const hasOpeningFence = rawLines[0].text === FENCE;
  let closingFenceIndex = -1;

  if (hasOpeningFence) {
    for (let i = 1; i < rawLines.length; i++) {
      if (rawLines[i].text === FENCE) {
        closingFenceIndex = i;
        break;
      }
    }
  }

  const lines: FenceLine[] = rawLines.map((line, index) => {
    let kind: FenceLine['kind'] = 'content';
    if (hasOpeningFence && index === 0) {
      kind = 'openingFence';
    } else if (index === closingFenceIndex) {
      kind = 'closingFence';
    }

    return { ...line, kind };
  });

  return {
    hasOpeningFence,
    hasClosingFence: closingFenceIndex !== -1,
    lines,
    closingFence: closingFenceIndex === -1 ? null : lines[closingFenceIndex],
  };
}

export function findFenceLineAtOffset(
  parsed: ParsedFenceMarkdown,
  offset: number,
): FenceLine | null {
  for (const line of parsed.lines) {
    if (offset >= line.from && offset <= line.to) {
      return line;
    }
  }
  return null;
}
