import { useEffect, useRef, useState } from 'react';
import type { CodeRunItem } from '../../page-frame/pm/code-block/run-store';
import { getPlatform } from '../../platform';
import { type DataResource, DataTable } from './data-table';

/** Frame height before its content reports in, and the most it grows to before scrolling. */
const FRAME_INITIAL_HEIGHT = 400;
const FRAME_MAX_HEIGHT = 800;
/** Card content width for HTML output, whose natural width the sandboxed frame can't report. */
export const FRAME_FIT_WIDTH = 640;

const TABLE_MIME = 'application/vnd.dataresource+json';
/** Richest first, like Jupyter; a bundle with none of these renders as its text/plain. */
const RICH_MIMES = [
  TABLE_MIME,
  'text/html',
  'image/png',
  'image/jpeg',
  'image/svg+xml',
] as const;

/** The MIME type an item renders as, or null when it renders as plain text. */
function richMime(item: CodeRunItem): (typeof RICH_MIMES)[number] | null {
  if (item.kind !== 'display') {
    return null;
  }
  return RICH_MIMES.find((mime) => item.data[mime] != null) ?? null;
}

export function OutputItemView({ item }: { item: CodeRunItem }) {
  if (item.kind === 'line') {
    return (
      <div
        className={
          item.stream === 'stderr'
            ? 'canvas-code-output__line is-stderr'
            : 'canvas-code-output__line'
        }
      >
        {item.text === '' ? ' ' : item.text}
      </div>
    );
  }

  const { data, metadata } = item;
  const mime = richMime(item);
  if (mime === TABLE_MIME) {
    const totalRows = (metadata[TABLE_MIME] as { totalRows?: number })
      ?.totalRows;
    return (
      <DataTable
        table={data[TABLE_MIME] as DataResource}
        totalRows={totalRows}
      />
    );
  }
  if (mime === 'text/html') {
    return <HtmlFrame html={String(data[mime])} />;
  }
  if (mime === 'image/png' || mime === 'image/jpeg') {
    const width = (metadata[mime] as { width?: number } | undefined)?.width;
    return (
      <img
        className="canvas-code-output__image"
        src={`data:${mime};base64,${data[mime]}`}
        style={{ width }}
        alt=""
      />
    );
  }
  if (mime === 'image/svg+xml') {
    // As an <img>, so any script inside the SVG never runs.
    return (
      <img
        className="canvas-code-output__image"
        src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(String(data[mime]))}`}
        alt=""
      />
    );
  }
  return (
    <div className="canvas-code-output__line">
      {String(data['text/plain'] ?? '')}
    </div>
  );
}

// Output HTML is untrusted, so it never enters the app DOM: it renders in a sandboxed frame on the
// `myelin-output` origin, which reports its content height back.
function HtmlFrame({ html }: { html: string }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(FRAME_INITIAL_HEIGHT);
  const frameUrl = getPlatform().codeRunner?.outputFrameUrl;

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const frameWindow = frameRef.current?.contentWindow;
      if (!frameWindow || event.source !== frameWindow) {
        return;
      }
      if (event.data?.type === 'ready') {
        frameWindow.postMessage({ type: 'render', html }, '*');
      } else if (
        event.data?.type === 'height' &&
        typeof event.data.height === 'number'
      ) {
        setHeight(Math.min(Math.max(event.data.height, 24), FRAME_MAX_HEIGHT));
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [html]);

  if (!frameUrl) {
    return null;
  }
  return (
    <iframe
      ref={frameRef}
      className="canvas-code-output__frame"
      src={frameUrl}
      sandbox="allow-scripts"
      title="Code output"
      style={{ height }}
    />
  );
}
