import { useMemo, useState } from 'react';

/** pandas' `to_json(orient="table")` shape (Frictionless Data Resource). */
export interface DataResource {
  schema: {
    fields: { name: string; type?: string }[];
    primaryKey?: string[];
  };
  data: Record<string, unknown>[];
}

interface SortState {
  field: string;
  descending: boolean;
}

const NUMERIC_TYPES = new Set(['integer', 'number']);

function compareCells(a: unknown, b: unknown): number {
  // Missing values sort after present ones (before them when descending).
  if (a == null || b == null) {
    return a == null ? (b == null ? 0 : 1) : -1;
  }
  if (typeof a === 'number' && typeof b === 'number') {
    return a - b;
  }
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

function formatCell(value: unknown): string {
  if (value == null) {
    return 'NaN';
  }
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

interface DataTableProps {
  table: DataResource;
  /** Rows in the full frame; more than `table.data.length` when the bootstrap truncated it. */
  totalRows?: number;
}

export function DataTable({ table, totalRows }: DataTableProps) {
  const [sort, setSort] = useState<SortState | null>(null);
  const fields = table.schema.fields;
  const indexFields = new Set(table.schema.primaryKey ?? []);

  const rows = useMemo(() => {
    if (!sort) {
      return table.data;
    }
    const sign = sort.descending ? -1 : 1;
    return [...table.data].sort(
      (a, b) => sign * compareCells(a[sort.field], b[sort.field]),
    );
  }, [table, sort]);

  // Ascending → descending → original order.
  const cycleSort = (field: string) =>
    setSort((current) =>
      current?.field !== field
        ? { field, descending: false }
        : current.descending
          ? null
          : { field, descending: true },
    );

  return (
    <div className="canvas-code-output__table-wrap">
      <table className="canvas-code-output__table">
        <thead>
          <tr>
            {fields.map((field) => (
              <th
                key={field.name}
                aria-sort={
                  sort?.field === field.name
                    ? sort.descending
                      ? 'descending'
                      : 'ascending'
                    : undefined
                }
              >
                <button type="button" onClick={() => cycleSort(field.name)}>
                  {field.name}
                  {sort?.field === field.name
                    ? sort.descending
                      ? ' ↓'
                      : ' ↑'
                    : ''}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {fields.map((field) => (
                <td
                  key={field.name}
                  className={
                    indexFields.has(field.name)
                      ? 'is-index'
                      : NUMERIC_TYPES.has(field.type ?? '')
                        ? 'is-numeric'
                        : undefined
                  }
                >
                  {formatCell(row[field.name])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {totalRows !== undefined && totalRows > table.data.length ? (
        <div className="canvas-code-output__table-note">
          Showing first {table.data.length.toLocaleString()} of{' '}
          {totalRows.toLocaleString()} rows
        </div>
      ) : null}
    </div>
  );
}
