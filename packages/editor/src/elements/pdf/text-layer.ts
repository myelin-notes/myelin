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

// Ported from pdf.js's TextLayerBuilder. Over empty layer space the hit lands on the layer itself,
// which WebKit resolves to its first text, flipping the selection upward. While selecting, a
// full-size `.endOfContent` takes those hits instead.
const endOfContentByLayer = new Map<HTMLElement, HTMLDivElement>();
let selectionListeners: AbortController | null = null;

/** Call once the layer's text has rendered; returns the cleanup for when the layer is removed. */
export function trackPdfTextSelection(layer: HTMLElement): () => void {
  const end = document.createElement('div');
  end.className = 'endOfContent';
  layer.append(end);
  layer.addEventListener('mousedown', () => layer.classList.add('selecting'));
  endOfContentByLayer.set(layer, end);
  selectionListeners ??= listenForSelection();
  return () => {
    endOfContentByLayer.delete(layer);
    if (endOfContentByLayer.size === 0) {
      selectionListeners?.abort();
      selectionListeners = null;
    }
  };
}

function listenForSelection(): AbortController {
  const controller = new AbortController();
  const { signal } = controller;
  // pdf.js moves the overlay only on WebKit and Chromium < 148; newer engines resolve hits on it.
  const chromium = /\bChrome\/(\d+)/.exec(navigator.userAgent);
  const movesEnd = chromium
    ? Number(chromium[1]) < 148
    : !navigator.userAgent.includes('Firefox/');
  let pointerDown = false;
  let previousRange: Range | null = null;
  const resetAll = () => {
    for (const [layer, end] of endOfContentByLayer) {
      resetEndOfContent(layer, end);
    }
  };
  document.addEventListener(
    'pointerdown',
    () => {
      pointerDown = true;
    },
    { signal },
  );
  document.addEventListener(
    'pointerup',
    () => {
      pointerDown = false;
      resetAll();
    },
    { signal },
  );
  window.addEventListener(
    'blur',
    () => {
      pointerDown = false;
      resetAll();
    },
    { signal },
  );
  document.addEventListener(
    'keyup',
    () => {
      if (!pointerDown) {
        resetAll();
      }
    },
    { signal },
  );
  document.addEventListener(
    'selectionchange',
    () => {
      const selection = document.getSelection();
      if (!selection || selection.rangeCount === 0) {
        resetAll();
        return;
      }
      const range = selection.getRangeAt(0);
      for (const [layer, end] of endOfContentByLayer) {
        if (range.intersectsNode(layer)) {
          layer.classList.add('selecting');
        } else {
          resetEndOfContent(layer, end);
        }
      }
      if (!movesEnd) {
        return;
      }
      // Which boundary the drag is moving, judged against the previous range as pdf.js does.
      const modifyStart =
        previousRange !== null &&
        (range.compareBoundaryPoints(Range.END_TO_END, previousRange) === 0 ||
          range.compareBoundaryPoints(Range.START_TO_END, previousRange) === 0);
      previousRange = range.cloneRange();
      let anchor: Node | null = modifyStart
        ? range.startContainer
        : range.endContainer;
      if (anchor.nodeType === Node.TEXT_NODE) {
        anchor = anchor.parentNode;
      }
      if (anchor?.nodeName === 'MARK') {
        anchor = anchor.parentNode;
      }
      if (anchor && !modifyStart && range.endOffset === 0) {
        // Nothing of `anchor` is selected; follow the last sibling that has content.
        let previous = anchor.previousSibling;
        while (previous && !previous.hasChildNodes()) {
          previous = previous.previousSibling;
        }
        anchor = previous ?? anchor;
      }
      const layer = anchor?.parentElement;
      const end = layer ? endOfContentByLayer.get(layer) : undefined;
      if (anchor && layer && end) {
        // Must stay user-select: none, though pdf.js makes it selectable here: a selectable overlay
        // can hold the selection end, which this move then drags along.
        layer.insertBefore(end, modifyStart ? anchor : anchor.nextSibling);
      }
    },
    { signal },
  );
  return controller;
}

function resetEndOfContent(layer: HTMLElement, end: HTMLDivElement): void {
  layer.append(end);
  layer.classList.remove('selecting');
}
