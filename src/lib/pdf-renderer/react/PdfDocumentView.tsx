import { useEffect, useState } from 'react';
import { Logger } from '@/lib/logger';
import { loadDocument, type PdfDocument } from '../document';
import type { PdfSource } from '../types';
import { PdfPage } from './PdfPage';

interface Props {
  src: PdfSource;
  scale?: number;
  className?: string;
  pageClassName?: string;
}

const logger = new Logger('PdfDocumentView');

export function PdfDocumentView({
  src,
  scale = 1,
  className,
  pageClassName,
}: Props) {
  const [doc, setDoc] = useState<PdfDocument | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    let loaded: PdfDocument | null = null;
    setError(null);
    setDoc(null);
    loadDocument(src).then(
      (d) => {
        if (cancelled) {
          d.destroy();
          return;
        }
        loaded = d;
        setDoc(d);
      },
      (err) => {
        if (cancelled) {
          return;
        }
        logger.error('Load document failed', {
          error: `${err?.name ?? 'Error'}: ${err?.message ?? String(err)}`,
          stack: err?.stack ?? '',
        });
        setError(err instanceof Error ? err : new Error(String(err)));
      },
    );
    return () => {
      cancelled = true;
      loaded?.destroy();
    };
  }, [src]);

  if (error) {
    return <div className={className}>Failed to load PDF: {error.message}</div>;
  }
  if (!doc) {
    return <div className={className}>Loading…</div>;
  }
  return (
    <div className={className}>
      {Array.from({ length: doc.numPages }, (_, i) => (
        <PdfPage
          key={i}
          document={doc}
          pageIndex={i}
          scale={scale}
          className={pageClassName}
        />
      ))}
    </div>
  );
}
