const MATCH_CLASS = 'pdf-search-match';
const CURRENT_CLASS = 'pdf-search-match pdf-search-match-current';

export interface PdfTextMark {
  piece: number;
  from: number;
  to: number;
  current: boolean;
}

/** Literal, case-insensitive matches in reading order. Canvas search counts these, so ordinals agree. */
export function findPdfTextMatches(
  text: string,
  query: string,
): { from: number; to: number }[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return [];
  }
  const haystack = text.toLowerCase();
  const matches: { from: number; to: number }[] = [];
  let at = haystack.indexOf(needle);
  while (at !== -1) {
    matches.push({ from: at, to: at + needle.length });
    at = haystack.indexOf(needle, at + needle.length);
  }
  return matches;
}

/**
 * Splits each match across the text pieces it spans, last first: wrapping in this order never
 * shifts the offsets of a mark still to be applied.
 */
export function planPdfTextMarks(
  pieces: readonly string[],
  query: string,
  current: number | null,
): PdfTextMark[] {
  const marks: PdfTextMark[] = [];
  let piece = 0;
  let pieceStart = 0;
  for (const [index, match] of findPdfTextMatches(
    pieces.join(''),
    query,
  ).entries()) {
    while (pieceStart + pieces[piece].length <= match.from) {
      pieceStart += pieces[piece].length;
      piece++;
    }
    for (let p = piece, start = pieceStart; start < match.to; p++) {
      const to = Math.min(match.to - start, pieces[p].length);
      const from = Math.max(match.from - start, 0);
      if (to > from) {
        marks.push({ piece: p, from, to, current: index === current });
      }
      start += pieces[p].length;
    }
  }
  return marks.reverse();
}

export function highlightPdfTextLayer(
  layer: HTMLElement,
  query: string,
  current: number | null,
): void {
  clearPdfTextLayerHighlight(layer);
  const nodes: (Text | null)[] = [];
  const pieces: string[] = [];
  const walker = document.createTreeWalker(
    layer,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
  );
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node instanceof Text) {
      nodes.push(node);
      pieces.push(node.data);
    } else if (node.nodeName === 'BR') {
      nodes.push(null);
      pieces.push('\n');
    }
  }
  for (const mark of planPdfTextMarks(pieces, query, current)) {
    const node = nodes[mark.piece];
    if (!node) {
      continue;
    }
    const matched = mark.from > 0 ? node.splitText(mark.from) : node;
    if (mark.to - mark.from < matched.length) {
      matched.splitText(mark.to - mark.from);
    }
    const element = document.createElement('mark');
    element.className = mark.current ? CURRENT_CLASS : MATCH_CLASS;
    matched.replaceWith(element);
    element.append(matched);
  }
}

export function clearPdfTextLayerHighlight(layer: HTMLElement): void {
  const marks = layer.querySelectorAll('mark');
  if (marks.length === 0) {
    return;
  }
  for (const mark of marks) {
    mark.replaceWith(...mark.childNodes);
  }
  layer.normalize();
}
