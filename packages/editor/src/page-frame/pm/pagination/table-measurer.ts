import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';
import type { ParagraphLine, TableRowLine } from './core';
import type {
  PaginationBlockInfo,
  ParagraphLineMeasurer,
} from './line-measurer';

function isTableRowBreakElement(element: Element): boolean {
  return (
    element instanceof HTMLTableRowElement &&
    element.getAttribute('data-page-break') === 'table-row'
  );
}

function collectTableRowTextBlocks(
  rowNode: PMNode,
  rowPos: number,
  view: EditorView,
): PaginationBlockInfo[] {
  const blocks: PaginationBlockInfo[] = [];

  rowNode.forEach((cell, cellOffset) => {
    const cellPos = rowPos + 1 + cellOffset;
    cell.forEach((child, childOffset) => {
      if (!child.isTextblock || child.type.name === 'codeBlock') {
        return;
      }

      const blockPos = cellPos + 1 + childOffset;
      const dom = view.nodeDOM(blockPos);
      if (!(dom instanceof HTMLElement) || dom.offsetHeight <= 0) {
        return;
      }

      blocks.push({
        pos: blockPos,
        dom,
        height: dom.offsetHeight,
        measuredTop: 0,
        nodeSize: child.nodeSize,
        isBreakableTextBlock: true,
        isBreakableTableBlock: false,
        isPageHeightConstrained: false,
      });
    });
  });

  return blocks;
}

function measureTableRowSplitLines(
  rowNode: PMNode,
  rowPos: number,
  view: EditorView,
  editorScreenTop: number,
  invScale: number,
  lineMeasurer: ParagraphLineMeasurer,
): ParagraphLine[] {
  const lines: ParagraphLine[] = [];

  for (const block of collectTableRowTextBlocks(rowNode, rowPos, view)) {
    lines.push(
      ...lineMeasurer.measure({
        block,
        view,
        editorScreenTop,
        invScale,
        metrics: null,
      }),
    );
  }

  return lines.sort(
    (a, b) => a.naturalTop - b.naturalTop || a.naturalBottom - b.naturalBottom,
  );
}

export function measureTableRows(
  block: PaginationBlockInfo,
  view: EditorView,
  editorScreenTop: number,
  invScale: number,
  lineMeasurer: ParagraphLineMeasurer,
): TableRowLine[] {
  const tableNode = view.state.doc.nodeAt(block.pos);
  if (!tableNode || tableNode.type.name !== 'table') {
    return [];
  }

  const tbody = block.dom.querySelector('tbody');
  if (!(tbody instanceof HTMLTableSectionElement)) {
    return [];
  }

  const rowInfo: Array<{ isHeaderRow: boolean; node: PMNode; pos: number }> =
    [];
  tableNode.forEach((row, offset) => {
    let cellCount = 0;
    let allHeaderCells = true;
    row.forEach((cell) => {
      cellCount++;
      if (cell.type.name !== 'table_header') {
        allHeaderCells = false;
      }
    });
    rowInfo.push({
      pos: block.pos + 1 + offset,
      node: row,
      isHeaderRow: cellCount > 0 && allHeaderCells,
    });
  });

  const rows: TableRowLine[] = [];
  let contentRowIndex = 0;

  for (const child of Array.from(tbody.children)) {
    if (!(child instanceof HTMLTableRowElement)) {
      continue;
    }
    if (isTableRowBreakElement(child)) {
      continue;
    }

    const info = rowInfo[contentRowIndex];
    contentRowIndex++;
    if (info === undefined) {
      continue;
    }

    const rect = child.getBoundingClientRect();

    rows.push({
      naturalTop: (rect.top - editorScreenTop) * invScale,
      naturalBottom: (rect.bottom - editorScreenTop) * invScale,
      getPos: () => info.pos,
      isHeaderRow: info.isHeaderRow,
      measureSplitLines: () =>
        measureTableRowSplitLines(
          info.node,
          info.pos,
          view,
          editorScreenTop,
          invScale,
          lineMeasurer,
        ),
    });
  }

  return rows;
}
