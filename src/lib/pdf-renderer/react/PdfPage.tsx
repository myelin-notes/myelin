import { useEffect, useRef, useState } from 'react';
import type { PdfDocument } from '../document';
import { renderPage } from '../page';

interface Props {
  document: PdfDocument;
  pageIndex: number;
  scale?: number;
  className?: string;
}

export function PdfPage({
  document: doc,
  pageIndex,
  scale = 1,
  className,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }
    let cancelled = false;
    setError(null);
    renderPage(doc, pageIndex, scale).then(
      (rendered) => {
        if (cancelled) {
          return;
        }
        host.replaceChildren(rendered);
      },
      (err) => {
        if (cancelled) {
          return;
        }
        console.error(
          `[pdf-renderer] render page ${pageIndex + 1} failed: ${err?.name ?? 'Error'}: ${err?.message ?? String(err)}\n${err?.stack ?? ''}`,
        );
        setError(err instanceof Error ? err : new Error(String(err)));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [doc, pageIndex, scale]);

  if (error) {
    return (
      <div className={className}>
        Failed to render page {pageIndex + 1}: {error.message}
      </div>
    );
  }
  return <div ref={hostRef} className={className} />;
}
