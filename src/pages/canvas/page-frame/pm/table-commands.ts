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
  removeColumn,
  removeRow,
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

function buildDeleteWholeTableTransaction(
  state: EditorState,
  tablePos: number,
): Transaction {
  const table = requireTableNodeAt(state, tablePos);
  let tr = state.tr.delete(tablePos, tablePos + table.nodeSize);

  if (tr.doc.childCount === 0) {
    const paragraph = state.schema.nodes.paragraph.createAndFill();
    if (!paragraph) {
      throw new Error('Unable to create a paragraph after deleting a table');
    }

    tr = tr.insert(0, paragraph).setSelection(TextSelection.create(tr.doc, 1));
    return tr;
  }

  const selectionPos = Math.min(tablePos, tr.doc.content.size);
  const nextSelection =
    Selection.findFrom(tr.doc.resolve(selectionPos), 1, true) ??
    Selection.findFrom(tr.doc.resolve(selectionPos), -1, true) ??
    Selection.near(tr.doc.resolve(selectionPos), 1);

  return tr.setSelection(nextSelection);
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

export function buildDeleteTableRowTransaction(
  state: EditorState,
  tablePos: number,
  rowIndex: number,
  columnIndex = 0,
): Transaction | null {
  const table = requireTableNodeAt(state, tablePos);
  const rect = buildTableRect(table, tablePos);
  if (rect.map.height <= 1) {
    return buildDeleteWholeTableTransaction(state, tablePos);
  }

  const deleteRowIndex = Math.max(0, Math.min(rowIndex, rect.map.height - 1));
  const tr = state.tr;
  removeRow(tr, rect, deleteRowIndex);

  return setSelectionInsideTableCell(
    tr,
    tablePos,
    Math.min(deleteRowIndex, rect.map.height - 2),
    columnIndex,
  );
}

export function buildDeleteTableColumnTransaction(
  state: EditorState,
  tablePos: number,
  columnIndex: number,
  rowIndex = 0,
): Transaction | null {
  const table = requireTableNodeAt(state, tablePos);
  const rect = buildTableRect(table, tablePos);
  if (rect.map.width <= 1) {
    return buildDeleteWholeTableTransaction(state, tablePos);
  }

  const deleteColumnIndex = Math.max(
    0,
    Math.min(columnIndex, rect.map.width - 1),
  );
  const tr = state.tr;
  removeColumn(tr, rect, deleteColumnIndex);

  return setSelectionInsideTableCell(
    tr,
    tablePos,
    rowIndex,
    Math.min(deleteColumnIndex, rect.map.width - 2),
  );
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
