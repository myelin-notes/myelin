import { Fragment, type ReactNode } from 'react';

interface SearchHighlightProps {
  text: string;
  /** Lowercased terms to mark within the text. */
  terms: readonly string[];
  className?: string;
}

const markClass =
  'rounded-[3px] bg-accent/30 px-[0.12em] font-medium text-text-primary';

/**
 * Renders `text` with every occurrence of any term wrapped in a subtle
 * highlight, so a search result visibly shows where the query matched. With no
 * terms it renders the text unchanged.
 */
export function SearchHighlight({
  text,
  terms,
  className,
}: SearchHighlightProps) {
  const ranges = findMatchRanges(text, terms);
  if (ranges.length === 0) {
    return <span className={className}>{text}</span>;
  }

  const parts: ReactNode[] = [];
  let cursor = 0;
  ranges.forEach(([start, end], i) => {
    if (start > cursor) {
      parts.push(
        <Fragment key={`t${i}`}>{text.slice(cursor, start)}</Fragment>,
      );
    }
    parts.push(
      <mark key={`m${i}`} className={markClass}>
        {text.slice(start, end)}
      </mark>,
    );
    cursor = end;
  });
  if (cursor < text.length) {
    parts.push(<Fragment key="tail">{text.slice(cursor)}</Fragment>);
  }

  return <span className={className}>{parts}</span>;
}

/** Find merged, non-overlapping match ranges for any term, case-insensitive. */
function findMatchRanges(
  text: string,
  terms: readonly string[],
): Array<[number, number]> {
  if (terms.length === 0) {
    return [];
  }
  const lower = text.toLowerCase();
  const ranges: Array<[number, number]> = [];
  for (const raw of terms) {
    const term = raw.toLowerCase();
    if (!term) {
      continue;
    }
    let from = 0;
    for (;;) {
      const at = lower.indexOf(term, from);
      if (at === -1) {
        break;
      }
      ranges.push([at, at + term.length]);
      from = at + term.length;
    }
  }
  if (ranges.length === 0) {
    return [];
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [ranges[0]];
  for (let i = 1; i < ranges.length; i++) {
    const last = merged[merged.length - 1];
    const [start, end] = ranges[i];
    if (start <= last[1]) {
      last[1] = Math.max(last[1], end);
    } else {
      merged.push([start, end]);
    }
  }
  return merged;
}
