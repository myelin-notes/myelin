import type { Node as PMNode, Schema } from 'prosemirror-model';
import {
  type EditorState,
  Selection,
  type Transaction,
} from 'prosemirror-state';
import { addColumn, addRow, TableMap } from 'prosemirror-tables';

function requireTableNodeAt(state: EditorState, tablePos: number): PMNode {
  const table = state.doc.nodeAt(tablePos);
  if (!table || table.type !== state.schema.nodes.table) {
    throw new Error(`Expected a table node at position ${tablePos}`);
  }
  return table;
}

function buildTableRect(table: PMNode, tablePos: number) {
  const map = TableMap.get(table);
  return {
    left: 0,
    right: map.width,
    top: 0,
    bottom: map.height,
    map,
    table,
    tableStart: tablePos + 1,
  };
}

export function setSelectionInsideTableCell(
  tr: Transaction,
  tablePos: number,
  rowIndex: number,
  columnIndex: number,
): Transaction {
  const table = tr.doc.nodeAt(tablePos);
  if (!table) {
    return tr;
  }

  const map = TableMap.get(table);
  const safeRow = Math.max(0, Math.min(rowIndex, map.height - 1));
  const safeColumn = Math.max(0, Math.min(columnIndex, map.width - 1));
  const cellPos = tablePos + 1 + map.positionAt(safeRow, safeColumn, table);

  return tr.setSelection(Selection.near(tr.doc.resolve(cellPos + 1), 1));
}

export function createTableNode(schema: Schema, rows = 2, columns = 2): PMNode {
  const rowCount = Math.max(1, rows);
  const columnCount = Math.max(1, columns);
  const tableType = schema.nodes.table;
  const rowType = schema.nodes.table_row;
  const headerCellType = schema.nodes.table_header;
  const cellType = schema.nodes.table_cell;

  if (!tableType || !rowType || !headerCellType || !cellType) {
    throw new Error('Table nodes are not registered in the schema');
  }

  const createCell = (useHeaderCell: boolean) => {
    const node = (useHeaderCell ? headerCellType : cellType).createAndFill();
    if (!node) {
      throw new Error('Unable to create an empty table cell');
    }
    return node;
  };

  const rowNodes = Array.from({ length: rowCount }, (_, rowIndex) =>
    rowType.create(
      null,
      Array.from({ length: columnCount }, () => createCell(rowIndex === 0)),
    ),
  );

  return tableType.create(null, rowNodes);
}

export function buildAddTableRowTransaction(
  state: EditorState,
  tablePos: number,
  rowIndex: number,
): Transaction {
  const table = requireTableNodeAt(state, tablePos);
  const rect = buildTableRect(table, tablePos);
  const insertRowIndex = Math.max(0, Math.min(rowIndex + 1, rect.map.height));
  const tr = addRow(state.tr, rect, insertRowIndex);
  return setSelectionInsideTableCell(tr, tablePos, insertRowIndex, 0);
}

export function buildAddTableColumnTransaction(
  state: EditorState,
  tablePos: number,
  columnIndex: number,
): Transaction {
  const table = requireTableNodeAt(state, tablePos);
  const rect = buildTableRect(table, tablePos);
  const insertColumnIndex = Math.max(
    0,
    Math.min(columnIndex + 1, rect.map.width),
  );
  const tr = addColumn(state.tr, rect, insertColumnIndex);
  return setSelectionInsideTableCell(tr, tablePos, 0, insertColumnIndex);
}
