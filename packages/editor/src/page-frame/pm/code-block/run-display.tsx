import { useCallback, useEffect, useRef, useState } from 'react';
import type { DisplayPayload } from '../../../code-runner/contract';
import { renderKatex } from '../math/render';

/** Ceiling for an HTML payload's frame; taller content scrolls inside it. */
const MAX_HTML_FRAME_HEIGHT = 420;
const INITIAL_HTML_FRAME_HEIGHT = 120;

/**
 * Baseline styling for HTML payloads. The frame is a separate document, so the
 * app's stylesheet doesn't reach it -- which is the point: a `_repr_html_` from
 * a library (pandas emits a whole `<style>` block) can't leak CSS into the app.
 * System colors follow the OS theme without needing the app's tokens.
 */
const HTML_FRAME_STYLE = `
  :root { color-scheme: light dark; }
  body {
    margin: 0;
    color: CanvasText;
    background: transparent;
    font: 12px/1.5 ui-sans-serif, system-ui, sans-serif;
  }
  table { border-collapse: collapse; }
  th, td { border: 1px solid color-mix(in srgb, CanvasText 25%, transparent); padding: 2px 8px; }
  img, svg { max-width: 100%; }
`;

/**
 * Locks the frame's document down further than the sandbox attribute alone:
 * no network of any kind, so an HTML payload can't phone home with a tracking
 * pixel or a remote stylesheet.
 */
const HTML_FRAME_CSP =
  "default-src 'none'; img-src data:; style-src 'unsafe-inline'";

export function DisplayItemView({ payload }: { payload: DisplayPayload }) {
  switch (payload.mime) {
    case 'image/png':
    case 'image/jpeg':
      return (
        <img
          className="pm-code-block__output-image"
          src={`data:${payload.mime};base64,${payload.data}`}
          alt="Run output"
        />
      );
    case 'image/svg+xml':
      // Rendered as an image rather than inlined, which keeps any script inside
      // the SVG inert.
      return (
        <img
          className="pm-code-block__output-image"
          src={`data:image/svg+xml;utf8,${encodeURIComponent(payload.data)}`}
          alt="Run output"
        />
      );
    case 'text/html':
      return <HtmlFrame html={payload.data} />;
    case 'text/latex':
      return <LatexView source={payload.data} />;
  }
}

/**
 * Renders an HTML payload inside an isolated frame. `sandbox` without
 * `allow-scripts` blocks script execution; `allow-same-origin` is what lets the
 * parent measure the content to size the frame, and is only dangerous when
 * paired with `allow-scripts`.
 */
function HtmlFrame({ html }: { html: string }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(INITIAL_HTML_FRAME_HEIGHT);

  const fitToContent = useCallback(() => {
    // The body, not documentElement: the latter's scrollHeight floors at the
    // frame's own height, so short content would never shrink the frame.
    const body = frameRef.current?.contentDocument?.body;
    if (body) {
      setHeight(Math.min(body.scrollHeight, MAX_HTML_FRAME_HEIGHT));
    }
  }, []);

  return (
    <iframe
      ref={frameRef}
      className="pm-code-block__output-frame"
      title="Run output"
      sandbox="allow-same-origin"
      style={{ height }}
      onLoad={fitToContent}
      srcDoc={`<!doctype html><meta http-equiv="Content-Security-Policy" content="${HTML_FRAME_CSP}"><style>${HTML_FRAME_STYLE}</style>${html}`}
    />
  );
}

/** Strips the `$`/`$$` delimiters libraries wrap their LaTeX repr in. */
function stripMathDelimiters(source: string): string {
  const trimmed = source.trim();
  for (const fence of ['$$', '$']) {
    if (
      trimmed.length > fence.length * 2 &&
      trimmed.startsWith(fence) &&
      trimmed.endsWith(fence)
    ) {
      return trimmed.slice(fence.length, -fence.length);
    }
  }
  return trimmed;
}

function LatexView({ source }: { source: string }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }
    host.replaceChildren(renderKatex(stripMathDelimiters(source), true));
  }, [source]);

  return <div className="pm-code-block__output-math" ref={hostRef} />;
}
