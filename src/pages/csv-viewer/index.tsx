import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, LoaderCircle } from 'lucide-react';
import { isDataFileType, useRepository, type VFSNodeId } from '@/lib/sync';
import { decodeText } from './decode';
import { type CsvTable, toCsvTable } from './parse';

const ROW_HEIGHT = 32;
const OVERSCAN = 8;
// Widths come from a sample, not the whole file: `table-layout: fixed` needs them up front, and
// measuring a million rows to size a column nobody has scrolled to yet is not worth the pass.
const WIDTH_SAMPLE_ROWS = 50;
const MIN_COL_CH = 6;
const MAX_COL_CH = 40;

type CsvViewerState =
  | { status: 'loading' }
  | { status: 'ready'; table: CsvTable | null; encoding: string }
  | { status: 'error'; message: string };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function columnWidths(table: CsvTable): number[] {
  const sample = table.rows.slice(0, WIDTH_SAMPLE_ROWS);
  return table.header.map((head, col) => {
    let widest = head.length;
    for (const row of sample) {
      widest = Math.max(widest, row[col].length);
    }
    return Math.min(MAX_COL_CH, Math.max(MIN_COL_CH, widest + 2));
  });
}

interface CsvViewerPageProps {
  id: VFSNodeId;
}

export function CsvViewerPage({ id }: CsvViewerPageProps) {
  const repository = useRepository();
  const [state, setState] = useState<CsvViewerState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setState({ status: 'loading' });

      const node = await repository.getNode(id);
      if (!node || node.type !== 'file' || !isDataFileType(node.fileType)) {
        throw new Error('This file is not a CSV.');
      }

      const bytes = await repository.readFileBytes(node.id);
      if (!bytes) {
        throw new Error('File data is missing.');
      }

      const { text, encoding } = decodeText(bytes);
      if (!cancelled) {
        setState({ status: 'ready', table: toCsvTable(text), encoding });
      }
    };

    load().catch((error) => {
      if (!cancelled) {
        setState({ status: 'error', message: errorMessage(error) });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [id, repository]);

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-page">
      {state.status === 'loading' && (
        <div className="flex flex-1 items-center justify-center gap-2 text-sm text-text-muted">
          <LoaderCircle className="size-4 animate-spin" />
          Loading table
        </div>
      )}

      {state.status === 'error' && (
        <div className="flex flex-1 items-center justify-center px-6">
          <div className="flex max-w-sm items-start gap-3 rounded-xl bg-surface px-4 py-3 text-text-secondary shadow-ambient">
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-text-muted" />
            <div>
              <p className="m-0 font-medium text-sm text-text-primary">
                Could not open file
              </p>
              <p className="mt-1 mb-0 text-sm">{state.message}</p>
            </div>
          </div>
        </div>
      )}

      {state.status === 'ready' &&
        (state.table === null ? (
          <div className="flex flex-1 items-center justify-center text-sm text-text-muted">
            This file is empty.
          </div>
        ) : (
          <CsvTableView table={state.table} encoding={state.encoding} />
        ))}
    </div>
  );
}

function CsvTableView({
  table,
  encoding,
}: {
  table: CsvTable;
  encoding: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) {
      return;
    }
    const observer = new ResizeObserver(() => {
      setViewportHeight(element.clientHeight);
    });
    observer.observe(element);
    setViewportHeight(element.clientHeight);
    return () => observer.disconnect();
  }, []);

  const widths = useMemo(() => columnWidths(table), [table]);
  const total = table.rows.length;
  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const end = Math.min(
    total,
    Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN,
  );

  return (
    <>
      <div
        ref={scrollRef}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        className="min-h-0 flex-1 overflow-auto"
      >
        <table
          className="border-separate border-spacing-0 text-sm tabular-nums"
          style={{ tableLayout: 'fixed' }}
        >
          <colgroup>
            {widths.map((ch, i) => (
              <col key={i} style={{ width: `${ch}ch` }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {table.header.map((cell, i) => (
                <th
                  key={i}
                  title={cell}
                  className="sticky top-0 z-10 truncate border-subtle border-r border-b bg-surface px-3 text-left font-medium text-text-primary"
                  style={{ height: ROW_HEIGHT }}
                >
                  {cell}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr style={{ height: start * ROW_HEIGHT }} />
            {table.rows.slice(start, end).map((row, i) => (
              <tr key={start + i} className="hover:bg-hover">
                {row.map((cell, col) => (
                  <td
                    key={col}
                    title={cell}
                    className="truncate border-subtle border-r border-b px-3 text-text-secondary"
                    style={{ height: ROW_HEIGHT }}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
            <tr style={{ height: (total - end) * ROW_HEIGHT }} />
          </tbody>
        </table>
      </div>
      <div className="shrink-0 border-subtle border-t px-3 py-1.5 text-text-muted text-xs">
        {total.toLocaleString()} {total === 1 ? 'row' : 'rows'} ·{' '}
        {table.columnCount} {table.columnCount === 1 ? 'column' : 'columns'}
        {encoding !== 'utf-8' && ` · ${encoding}`}
      </div>
    </>
  );
}
