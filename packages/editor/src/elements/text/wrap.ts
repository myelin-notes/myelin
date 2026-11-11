const wordSegmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
const graphemeSegmenter = new Intl.Segmenter(undefined, {
  granularity: 'grapheme',
});

let measureContext:
  | CanvasRenderingContext2D
  | OffscreenCanvasRenderingContext2D
  | null = null;

function getMeasureContext() {
  measureContext ??=
    typeof OffscreenCanvas === 'undefined'
      ? document.createElement('canvas').getContext('2d')
      : new OffscreenCanvas(1, 1).getContext('2d');
  if (!measureContext) {
    throw new Error('Text measurement requires a 2D canvas context.');
  }
  return measureContext;
}

export function measureTextWidth(text: string, font: string): number {
  const context = getMeasureContext();
  context.font = font;
  return context.measureText(text).width;
}

/**
 * Greedy wrap for paths with no rendered DOM to read (PDF export, thumbnails), matching the text
 * box's `pre-wrap` + `break-word`: newlines are kept, trailing spaces hang, and a word wider than
 * the box breaks between graphemes. `measure` must use the same units as `maxWidth`.
 */
export function wrapTextLines(
  text: string,
  maxWidth: number,
  measure: (text: string) => number,
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    const place = (piece: string, granularity: Intl.Segmenter | null) => {
      if (measure(line + piece) <= maxWidth || !piece.trim()) {
        line += piece;
        return;
      }
      if (line) {
        lines.push(line.trimEnd());
        line = '';
      }
      if (measure(piece) <= maxWidth) {
        line = piece;
      } else if (granularity) {
        for (const { segment } of granularity.segment(piece)) {
          place(segment, null);
        }
      } else {
        // A single grapheme wider than the box still has to go somewhere.
        line = piece;
      }
    };
    for (const { segment } of wordSegmenter.segment(paragraph)) {
      place(segment, graphemeSegmenter);
    }
    lines.push(line.trimEnd());
  }
  return lines;
}
