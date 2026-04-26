import type { Node as PMNode, Schema } from 'prosemirror-model';
import {
  type Command,
  type EditorState,
  Selection,
  TextSelection,
  type Transaction,
} from 'prosemirror-state';
import {
  addColumn,
  addRow,
  findCell,
  findTable,
  isInTable,
  selectionCell,
  TableMap,
} from 'prosemirror-tables';

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

function getTableSelectionContext(state: EditorState) {
  if (!state.selection.empty || !isInTable(state)) {
    return null;
  }

  const $cell = selectionCell(state);
  const table = findTable($cell);
  if (!table) {
    return null;
  }

  return {
    cellRect: findCell($cell),
    table: table.node,
    tablePos: table.pos,
    tableMap: TableMap.get(table.node),
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
  columnIndex = 0,
): Transaction {
  const table = requireTableNodeAt(state, tablePos);
  const rect = buildTableRect(table, tablePos);
  const insertRowIndex = Math.max(0, Math.min(rowIndex + 1, rect.map.height));
  const tr = addRow(state.tr, rect, insertRowIndex);
  return setSelectionInsideTableCell(tr, tablePos, insertRowIndex, columnIndex);
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

export const goToNextTableRow: Command = (state, dispatch) => {
  const context = getTableSelectionContext(state);
  if (!context) {
    return false;
  }

  const nextRowIndex = context.cellRect.bottom;
  const columnIndex = context.cellRect.left;
  const tr =
    nextRowIndex < context.tableMap.height
      ? setSelectionInsideTableCell(
          state.tr,
          context.tablePos,
          nextRowIndex,
          columnIndex,
        )
      : buildAddTableRowTransaction(
          state,
          context.tablePos,
          context.tableMap.height - 1,
          columnIndex,
        );

  dispatch?.(tr.scrollIntoView());
  return true;
};

export const exitTableOnLastRow: Command = (state, dispatch) => {
  const context = getTableSelectionContext(state);
  if (!context || context.cellRect.bottom < context.tableMap.height) {
    return false;
  }

  const insertPos = context.tablePos + context.table.nodeSize;
  let tr = state.tr;
  const nextNode = tr.doc.resolve(insertPos).nodeAfter;

  if (nextNode?.isTextblock) {
    tr = tr.setSelection(TextSelection.create(tr.doc, insertPos + 1));
    dispatch?.(tr.scrollIntoView());
    return true;
  }

  const paragraph = state.schema.nodes.paragraph.createAndFill();
  if (!paragraph) {
    return false;
  }

  tr = tr
    .insert(insertPos, paragraph)
    .setSelection(TextSelection.create(tr.doc, insertPos + 1));
  dispatch?.(tr.scrollIntoView());
  return true;
};
