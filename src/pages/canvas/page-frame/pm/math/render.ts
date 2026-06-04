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

export function renderKatex(src: string, displayMode: boolean): HTMLElement {
  const el = document.createElement(displayMode ? 'div' : 'span');
  el.className = displayMode ? 'pm-math-block-render' : 'pm-math-inline';
  el.contentEditable = 'false';
  el.innerHTML = katexToString(src, displayMode);
  return el;
}
