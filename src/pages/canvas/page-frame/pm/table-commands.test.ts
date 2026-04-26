import { EditorState } from 'prosemirror-state';
import { cellAround, findCell } from 'prosemirror-tables';
import { describe, expect, it } from 'vitest';
import { schema } from './schema';
import {
  buildAddTableColumnTransaction,
  buildAddTableRowTransaction,
  createTableNode,
} from './table-commands';

function createTableState(rows = 2, columns = 2) {
  return EditorState.create({
    schema,
    doc: schema.nodes.doc.create(null, [
      createTableNode(schema, rows, columns),
    ]),
  });
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
});
