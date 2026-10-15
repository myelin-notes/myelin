import type { Mermaid } from 'mermaid';
import { onCanvasThemeChange } from '../../../canvas-theme';

interface MermaidFrame {
  mermaid: Mermaid;
  doc: Document;
}

const FRAME_STYLE: Partial<CSSStyleDeclaration> = {
  position: 'fixed',
  left: '-10000px',
  top: '0px',
  width: '1024px',
  height: '768px',
  border: '0',
  visibility: 'hidden',
  pointerEvents: 'none',
};

const CSS_URL_RE = /url\(\s*(['"]?)(.*?)\1\s*\)/g;

let framePromise: Promise<MermaidFrame> | null = null;
let configuredDark: boolean | null = null;
let renderId = 0;
let renderQueue: Promise<unknown> = Promise.resolve();

const themeListeners = new Set<() => void>();
let themeSubscribed = false;
let observedDark = false;

function isDarkTheme(): boolean {
  return document.documentElement.classList.contains('dark');
}

function collectFontFaceCss(rules: CSSRuleList, baseUrl: string): string[] {
  const css: string[] = [];
  for (const rule of rules) {
    if (rule instanceof CSSFontFaceRule) {
      // Relative srcs resolve against the sheet, not the frame's about:blank document.
      css.push(
        rule.cssText.replace(
          CSS_URL_RE,
          (_match, _quote, url: string) =>
            `url("${new URL(url, baseUrl).href}")`,
        ),
      );
    } else if ('cssRules' in rule) {
      css.push(...collectFontFaceCss(rule.cssRules as CSSRuleList, baseUrl));
    }
  }
  return css;
}

// Labels are measured inside the frame, so it needs the app's fonts to size nodes the way they
// display.
function buildFrameCss(fontSans: string): string {
  const css: string[] = [];
  if (fontSans) {
    css.push(`:root { --font-sans: ${fontSans}; }`);
  }
  for (const sheet of document.styleSheets) {
    try {
      css.push(
        ...collectFontFaceCss(sheet.cssRules, sheet.href ?? document.baseURI),
      );
    } catch {
      // Cross-origin sheets don't expose their rules.
    }
  }
  return css.join('\n');
}

/**
 * Mermaid renders in its own document. In WebKit, adding or removing a stylesheet in the app's
 * document restyles the whole app, and every render adds a temp `<style>` under <body> (with a
 * `:root` rule) then removes it: ~95ms of style + layout per diagram on a 40-page note. Its
 * renderers look the SVG up from `body`, so a shadow root can't contain it — a separate document
 * can.
 */
async function createMermaidFrame(): Promise<MermaidFrame> {
  const { default: scriptUrl } = await import(
    'mermaid/dist/mermaid.min.js?url'
  );
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.tabIndex = -1;
  Object.assign(iframe.style, FRAME_STYLE);
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument;
  const win = iframe.contentWindow as (Window & { mermaid?: Mermaid }) | null;
  if (!(doc && win)) {
    iframe.remove();
    throw new Error('Mermaid frame has no document');
  }

  const fontSans = getComputedStyle(document.documentElement)
    .getPropertyValue('--font-sans')
    .trim();
  const style = doc.createElement('style');
  style.textContent = buildFrameCss(fontSans);
  doc.head.appendChild(style);

  await new Promise<void>((resolve, reject) => {
    const script = doc.createElement('script');
    script.src = scriptUrl;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load mermaid'));
    doc.head.appendChild(script);
  }).catch((error) => {
    iframe.remove();
    throw error;
  });

  if (!win.mermaid) {
    iframe.remove();
    throw new Error('Mermaid script did not register');
  }
  // Otherwise the first diagram measures its labels in the fallback font.
  if (fontSans) {
    await doc.fonts.load(`16px ${fontSans}`).catch(() => undefined);
  }
  return { mermaid: win.mermaid, doc };
}

function loadMermaidFrame(): Promise<MermaidFrame> {
  // Don't cache a rejection: clear the slot so a later render retries instead of re-awaiting the
  // same failure.
  framePromise ??= createMermaidFrame().catch((error) => {
    framePromise = null;
    throw error;
  });
  return framePromise;
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function renderNow(source: string): Promise<string> {
  const { mermaid, doc } = await loadMermaidFrame();
  const dark = isDarkTheme();
  if (dark !== configuredDark) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: dark ? 'dark' : 'neutral',
      fontFamily: 'var(--font-sans)',
    });
    configuredDark = dark;
  }

  const id = `pm-mermaid-${renderId++}`;
  try {
    const { svg } = await mermaid.render(id, source);
    return svg;
  } catch (error) {
    // A failed parse can leave mermaid's scratch element in the body.
    doc.getElementById(id)?.remove();
    doc.getElementById(`d${id}`)?.remove();
    throw error;
  }
}

// Mermaid bakes colors into the SVG at render time, so theme flips need a re-render (see
// onMermaidThemeChange). Throws on invalid source; callers keep their last good diagram.
// The returned SVG carries its own <style>: insert it into a shadow root, not the app's document.
export function renderMermaidSvg(source: string): Promise<string> {
  // One render per task: a note opening with dozens of diagrams would otherwise lay them all out
  // back to back in a single frame.
  const result = renderQueue
    .then(yieldToEventLoop)
    .then(() => renderNow(source));
  renderQueue = result.catch(() => undefined);
  return result;
}

/**
 * Piggybacks on the canvas theme observer rather than owning a MutationObserver. That observer
 * fires on any <html> class mutation, so a shared handler filters down to actual dark/light flips
 * before notifying — the flip check runs once, not per subscriber.
 */
export function onMermaidThemeChange(listener: () => void): () => void {
  if (!themeSubscribed) {
    themeSubscribed = true;
    observedDark = isDarkTheme();
    onCanvasThemeChange(() => {
      const dark = isDarkTheme();
      if (dark === observedDark) {
        return;
      }
      observedDark = dark;
      for (const notify of themeListeners) {
        notify();
      }
    });
  }

  themeListeners.add(listener);
  return () => {
    themeListeners.delete(listener);
  };
}
