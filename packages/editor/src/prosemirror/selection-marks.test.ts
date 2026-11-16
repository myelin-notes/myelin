import { EditorState } from 'prosemirror-state';
import { CellSelection } from 'prosemirror-tables';
import { describe, expect, it } from 'vitest';
import { schema } from '../page-frame/pm/schema';
import { uniformSelectionMarkAttrs } from './selection-marks';

describe('uniformSelectionMarkAttrs', () => {
  it('reads every cell of a cell selection, not just the first', () => {
    const { table, table_row, table_cell, paragraph } = schema.nodes;
    const big = schema.marks.fontSize.create({ size: 20 });
    const doc = schema.nodes.doc.create(null, [
      table.create(null, [
        table_row.create(null, [
          table_cell.create(
            null,
            paragraph.create(null, schema.text('A1', [big])),
          ),
          table_cell.create(null, paragraph.create(null, schema.text('B1'))),
        ]),
      ]),
    ]);
    // Head on A1 (pos 2), anchor on B1 (pos 8): the head cell is the selection's from..to.
    const state = EditorState.create({
      doc,
      selection: CellSelection.create(doc, 8, 2),
    });

    expect(uniformSelectionMarkAttrs(state, schema.marks.fontSize)).toBeNull();
  });
});
