import { splitLines } from '../markdown/parse-fences';
import type { FenceLine, ParsedFenceMarkdown } from '../markdown/types';

const MATH_FENCE = '$$';

/**
 * A whole line of the form `$$...$$` with non-empty content. Used by the
 * markdown importer to recognize single-line block math, which is
 * canonicalized into the multi-line form (`$$\n...\n$$`) so math blocks have
 * a single invariant: first line `$$`, a later line `$$`.
 */
export const SINGLE_LINE_MATH_BLOCK_RE = /^\$\$(.+)\$\$$/;

export function isMathFenceLine(text: string): boolean {
  return text === MATH_FENCE;
}

export function parseMathMarkdown(text: string): ParsedFenceMarkdown {
  const rawLines = splitLines(text);
  if (rawLines.length === 0) {
    return {
      hasOpeningFence: false,
      hasClosingFence: false,
      lines: [],
      closingFence: null,
    };
  }

  const hasOpeningFence = isMathFenceLine(rawLines[0].text);
  let closingFenceIndex = -1;

  if (hasOpeningFence) {
    for (let i = 1; i < rawLines.length; i++) {
      if (isMathFenceLine(rawLines[i].text)) {
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

/** LaTeX source between the `$$` fence lines, for rendering. */
export function stripMathDelimiters(text: string): string {
  const parsed = parseMathMarkdown(text);
  if (!parsed.hasOpeningFence) {
    return text;
  }

  return parsed.lines
    .filter((line) => line.kind === 'content')
    .map((line) => line.text)
    .join('\n');
}
