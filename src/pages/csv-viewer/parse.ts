/**
 * RFC 4180 CSV reader. Fields may be double-quoted, in which case `""` is a literal quote and
 * delimiters/newlines inside the quotes are data. Rows are ragged — the caller pads to the widest.
 * Returns `[]` for input that is empty or only a trailing newline.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let dirty = false;

  const endField = () => {
    row.push(field);
    field = '';
    dirty = true;
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
    dirty = false;
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (quoted) {
      if (char !== '"') {
        field += char;
      } else if (text[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        quoted = false;
      }
      continue;
    }

    if (char === '"' && field === '') {
      quoted = true;
      dirty = true;
    } else if (char === ',') {
      endField();
    } else if (char === '\r' && text[i + 1] === '\n') {
      endRow();
      i++;
    } else if (char === '\n' || char === '\r') {
      endRow();
    } else {
      field += char;
    }
  }

  if (dirty || field !== '') {
    endRow();
  }
  return rows;
}

export interface CsvTable {
  header: string[];
  rows: string[][];
  columnCount: number;
}

/** `null` when the file holds no rows. First row is taken as the header. */
export function toCsvTable(text: string): CsvTable | null {
  const rows = parseCsv(text);
  if (rows.length === 0) {
    return null;
  }

  const columnCount = rows.reduce((max, r) => Math.max(max, r.length), 0);
  const pad = (r: string[]) =>
    r.length === columnCount
      ? r
      : [...r, ...Array<string>(columnCount - r.length).fill('')];

  return {
    header: pad(rows[0]),
    rows: rows.slice(1).map(pad),
    columnCount,
  };
}
