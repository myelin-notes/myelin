import type { Node as PMNode } from 'prosemirror-model';
import {
  canonicalizeLanguage,
  type RunnableLanguage,
} from '../../../code-runner/contract';
import {
  isClosingFenceLine,
  isOpeningFenceLine,
  OPENING_FENCE_TOKEN_RE,
} from '../markdown/parse-fences';

/** Reads the canonical runnable language from a code block's fenced text. */
export function parseBlockLanguage(blockText: string): RunnableLanguage | null {
  const firstLine = blockText.split('\n', 1)[0] ?? '';
  const token = firstLine.match(OPENING_FENCE_TOKEN_RE)?.[1];
  if (!token) {
    return null;
  }
  return canonicalizeLanguage(token);
}

export interface FenceSource {
  closingFenceLine: number | null;
  delimiterLines: readonly number[];
}

// Returns nulls when the text isn't a complete `opening…closing` fenced block.
export function parseFenceSource(text: string): FenceSource {
  const lines = text.split('\n');
  const closingFenceLine = lines.length;

  if (
    !isOpeningFenceLine(lines[0]) ||
    closingFenceLine <= 1 ||
    !isClosingFenceLine(lines[closingFenceLine - 1])
  ) {
    return {
      closingFenceLine: null,
      delimiterLines: [],
    };
  }

  return {
    closingFenceLine,
    delimiterLines: [1, closingFenceLine],
  };
}

/** Drops the opening and closing fence lines, returning just the code body. */
export function stripFences(blockText: string): string {
  const lines = blockText.split('\n');
  if (
    lines.length >= 2 &&
    isOpeningFenceLine(lines[0]) &&
    isClosingFenceLine(lines[lines.length - 1])
  ) {
    return lines.slice(1, -1).join('\n');
  }
  return blockText;
}

export interface RunSource {
  language: RunnableLanguage;
  source: string;
}

// Org-mode style: concatenates the bodies of every same-language code block up to and including
// the target, in document order. Null when the target isn't a runnable code block.
export function collectRunSource(
  doc: PMNode,
  targetPos: number,
): RunSource | null {
  const target = doc.nodeAt(targetPos);
  if (!target || target.type.name !== 'codeBlock') {
    return null;
  }

  const language = parseBlockLanguage(target.textContent);
  if (!language) {
    return null;
  }

  const bodies: string[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== 'codeBlock') {
      return true;
    }
    if (pos <= targetPos && parseBlockLanguage(node.textContent) === language) {
      bodies.push(stripFences(node.textContent));
    }
    return false;
  });

  return { language, source: bodies.join('\n') };
}
