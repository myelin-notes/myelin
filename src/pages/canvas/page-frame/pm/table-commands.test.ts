import type { Node as PMNode } from 'prosemirror-model';
import { EditorState, type Transaction } from 'prosemirror-state';
import { cellAround, findCell } from 'prosemirror-tables';
import { describe, expect, it } from 'vitest';
import { schema } from './schema';
import {
  buildAddTableColumnTransaction,
  buildAddTableRowTransaction,
  buildDeleteTableColumnTransaction,
  buildDeleteTableRowTransaction,
  createTableNode,
  exitTableOnLastRow,
  goToNextTableRow,
  setSelectionInsideTableCell,
} from './table-commands';

function createTableState(
  rows = 2,
  columns = 2,
  trailingNodes: readonly PMNode[] = [],
) {
  return EditorState.create({
    schema,
    doc: schema.nodes.doc.create(null, [
      createTableNode(schema, rows, columns),
      ...trailingNodes,
    ]),
  });
}

function selectCell(state: EditorState, rowIndex: number, columnIndex: number) {
  return state.apply(
    setSelectionInsideTableCell(state.tr, 0, rowIndex, columnIndex),
  );
}

function applyCommand(state: EditorState, command: typeof goToNextTableRow) {
  let appliedTransaction: Transaction | null = null;
  const handled = command(state, (tr) => {
    appliedTransaction = tr;
  });

  return {
    handled,
    transaction: appliedTransaction,
    state: appliedTransaction ? state.apply(appliedTransaction) : state,
  };
}

describe('table commands', () => {
  it('adds a row after the requested row and moves selection into it', () => {
    const state = createTableState();
    const tr = buildAddTableRowTransaction(state, 0, 0);
    const nextState = state.apply(tr);
    const table = nextState.doc.firstChild;

    expect(table?.type.name).toBe('table');
    expect(table?.childCount).toBe(3);
    expect(table?.child(1).child(0).type.name).toBe('table_cell');
    expect(findCell(cellAround(nextState.selection.$from)!)).toEqual({
      left: 0,
      top: 1,
      right: 1,
      bottom: 2,
    });
  });

  it('adds a column after the requested column and moves selection into it', () => {
    const state = createTableState();
    const tr = buildAddTableColumnTransaction(state, 0, 0);
    const nextState = state.apply(tr);
    const table = nextState.doc.firstChild;

    expect(table?.type.name).toBe('table');
    expect(table?.child(0).childCount).toBe(3);
    expect(table?.child(0).child(1).type.name).toBe('table_header');
    expect(table?.child(1).child(1).type.name).toBe('table_cell');
    expect(findCell(cellAround(nextState.selection.$from)!)).toEqual({
      left: 1,
      top: 0,
      right: 2,
      bottom: 1,
    });
  });

  it('deletes a row and moves selection into the nearest remaining row', () => {
    const state = selectCell(createTableState(3, 3), 1, 2);
    const tr = buildDeleteTableRowTransaction(state, 0, 1, 2);

    expect(tr).not.toBeNull();

    const nextState = state.apply(tr!);
    const table = nextState.doc.firstChild;

    expect(table?.type.name).toBe('table');
    expect(table?.childCount).toBe(2);
    expect(findCell(cellAround(nextState.selection.$from)!)).toEqual({
      left: 2,
      top: 1,
      right: 3,
      bottom: 2,
    });
  });

  it('deletes a column and moves selection into the nearest remaining column', () => {
    const state = selectCell(createTableState(3, 3), 2, 1);
    const tr = buildDeleteTableColumnTransaction(state, 0, 1, 2);

    expect(tr).not.toBeNull();

    const nextState = state.apply(tr!);
    const table = nextState.doc.firstChild;

    expect(table?.type.name).toBe('table');
    expect(table?.child(0).childCount).toBe(2);
    expect(findCell(cellAround(nextState.selection.$from)!)).toEqual({
      left: 1,
      top: 2,
      right: 2,
      bottom: 3,
    });
  });

  it('deletes the table when removing its last remaining row', () => {
    const state = createTableState(1, 3);
    const tr = buildDeleteTableRowTransaction(state, 0, 0);

    expect(tr).not.toBeNull();

    const nextState = state.apply(tr!);
    expect(nextState.doc.childCount).toBe(1);
    expect(nextState.doc.firstChild?.type).toBe(schema.nodes.paragraph);
    expect(nextState.selection.$from.parent.type).toBe(schema.nodes.paragraph);
  });

  it('deletes the table when removing its last remaining column', () => {
    const paragraph = schema.nodes.paragraph.createAndFill();
    if (!paragraph) {
      throw new Error('Expected paragraph.createAndFill() to succeed');
    }

    const state = createTableState(3, 1, [paragraph]);
    const tr = buildDeleteTableColumnTransaction(state, 0, 0);

    expect(tr).not.toBeNull();

    const nextState = state.apply(tr!);
    expect(nextState.doc.childCount).toBe(1);
    expect(nextState.doc.firstChild?.type).toBe(schema.nodes.paragraph);
    expect(nextState.selection.$from.parent.type).toBe(schema.nodes.paragraph);
  });

  it('moves selection into the next row in the same column', () => {
    const state = selectCell(createTableState(3, 3), 0, 1);
    const result = applyCommand(state, goToNextTableRow);

    expect(result.handled).toBe(true);
    expect(result.state.doc.toJSON()).toEqual(state.doc.toJSON());
    expect(findCell(cellAround(result.state.selection.$from)!)).toEqual({
      left: 1,
      top: 1,
      right: 2,
      bottom: 2,
    });
  });

  it('adds a row at the end when moving past the last table row', () => {
    const state = selectCell(createTableState(2, 3), 1, 2);
    const result = applyCommand(state, goToNextTableRow);
    const table = result.state.doc.firstChild;

    expect(result.handled).toBe(true);
    expect(table?.type.name).toBe('table');
    expect(table?.childCount).toBe(3);
    expect(findCell(cellAround(result.state.selection.$from)!)).toEqual({
      left: 2,
      top: 2,
      right: 3,
      bottom: 3,
    });
  });

  it('exits the table from the last row by inserting a paragraph after it', () => {
    const state = selectCell(createTableState(2, 2), 1, 0);
    const result = applyCommand(state, exitTableOnLastRow);

    expect(result.handled).toBe(true);
    expect(result.state.doc.childCount).toBe(2);
    expect(result.state.doc.child(1).type).toBe(schema.nodes.paragraph);
    expect(result.state.selection.$from.parent.type).toBe(
      schema.nodes.paragraph,
    );
    expect(result.state.selection.$from.parentOffset).toBe(0);
  });

  it('does not exit the table when a lower row still exists', () => {
    const state = selectCell(createTableState(3, 2), 1, 0);
    const result = applyCommand(state, exitTableOnLastRow);

    expect(result.handled).toBe(false);
    expect(result.transaction).toBeNull();
    expect(result.state).toBe(state);
  });
});
