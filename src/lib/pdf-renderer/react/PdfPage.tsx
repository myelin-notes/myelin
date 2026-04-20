import { useEffect, useRef, useState } from 'react';
import { Logger } from '@/lib/logger';
import type { PdfDocument } from '../document';
import { renderPage } from '../page';

interface Props {
  document: PdfDocument;
  pageIndex: number;
  scale?: number;
  className?: string;
}

const logger = new Logger('PdfPage');

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
        logger.error('Render page failed', {
          pageIndex: pageIndex + 1,
          error: `${err?.name ?? 'Error'}: ${err?.message ?? String(err)}`,
          stack: err?.stack ?? '',
        });
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
