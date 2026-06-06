import katex from 'katex';

const CACHE_LIMIT = 500;
const htmlCache = new Map<string, string>();

function katexToString(src: string, displayMode: boolean): string {
  const key = `${displayMode ? 'B' : 'I'}:${src}`;
  let html = htmlCache.get(key);
  if (html === undefined) {
    html = katex.renderToString(src, { throwOnError: false, displayMode });
    if (htmlCache.size >= CACHE_LIMIT) {
      htmlCache.delete(htmlCache.keys().next().value!);
    }
    htmlCache.set(key, html);
  }
  return html;
}

/**
 * The ParseError for a block's LaTeX source, or null when it renders (or
 * fails with something other than a parse error). Feeds the source editor's
 * lint extension; positions are offsets into `src`, the stripped source.
 */
export function mathParseError(src: string): katex.ParseError | null {
  try {
    katex.renderToString(src, { throwOnError: true, displayMode: true });
    return null;
  } catch (error) {
    return error instanceof katex.ParseError ? error : null;
  }
}

export function renderKatex(src: string, displayMode: boolean): HTMLElement {
  const el = document.createElement(displayMode ? 'div' : 'span');
  el.className = displayMode ? 'pm-math-block-render' : 'pm-math-inline';
  el.contentEditable = 'false';
  el.innerHTML = katexToString(src, displayMode);
  return el;
}
