const FIGURE_SOURCE_RE =
  /^!\[([^\]\n]*)\]\(([^)\n]+?)(?:\s+"((?:[^"\\\n]|\\.)*)")?\)$/;

export interface FigureSource {
  alt: string | null;
  src: string;
  /** Raw inline markdown, with `\"` unescaped. */
  caption: string;
}

/** `null` unless `text` is exactly one image, with an optional `"caption"` title. */
export function parseFigureSource(text: string): FigureSource | null {
  const match = text.trim().match(FIGURE_SOURCE_RE);
  if (!match) {
    return null;
  }
  return {
    alt: match[1] || null,
    src: match[2].trim(),
    caption: (match[3] ?? '').replace(/\\"/g, '"'),
  };
}
