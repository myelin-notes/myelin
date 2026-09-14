import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';
import type { ParagraphLine, TableRowLine } from './core';
import { measureLinesWithDom, type PaginationBlockInfo } from './line-measurer';

function isTableRowBreakElement(element: Element): boolean {
  return (
    element instanceof HTMLTableRowElement &&
    element.getAttribute('data-page-break') === 'table-row'
  );
}

function measureBreakWidgetHeight(
  element: HTMLElement,
  invScale: number,
): number {
  const rect = element.getBoundingClientRect();
  if (rect.height > 0) {
    return rect.height * invScale;
  }
  return element.offsetHeight;
}

function measureCellBreakShift(
  cell: HTMLTableCellElement,
  invScale: number,
): number {
  let shift = 0;
  for (const element of cell.querySelectorAll<HTMLElement>(
    '[data-page-break="block"], [data-page-break="inline"]',
  )) {
    shift += measureBreakWidgetHeight(element, invScale);
  }
  return shift;
}

function measureRowInternalBreakShift(
  row: HTMLTableRowElement,
  invScale: number,
): number {
  let maxCellShift = 0;
  for (const cell of Array.from(row.cells)) {
    maxCellShift = Math.max(
      maxCellShift,
      measureCellBreakShift(cell, invScale),
    );
  }
  return maxCellShift;
}

function measureCellBreakShiftBeforeBlock(
  blockDom: HTMLElement,
  invScale: number,
): number {
  const cell = blockDom.closest('td, th');
  if (!(cell instanceof HTMLTableCellElement)) {
    return 0;
  }

  const blockTop = blockDom.getBoundingClientRect().top;
  let shift = 0;
  for (const element of cell.querySelectorAll<HTMLElement>(
    '[data-page-break="block"], [data-page-break="inline"]',
  )) {
    if (element.getBoundingClientRect().bottom <= blockTop + 0.5) {
      shift += measureBreakWidgetHeight(element, invScale);
    }
  }
  return shift;
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
  rowExternalShift: number,
): ParagraphLine[] {
  const lines: ParagraphLine[] = [];

  for (const block of collectTableRowTextBlocks(rowNode, rowPos, view)) {
    const cellBreakShiftBeforeBlock = measureCellBreakShiftBeforeBlock(
      block.dom,
      invScale,
    );
    lines.push(
      ...measureLinesWithDom(
        block,
        view,
        editorScreenTop,
        invScale,
        null,
        rowExternalShift + cellBreakShiftBeforeBlock,
        null,
        null,
      ),
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
  blockShift: number,
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
  let innerShift = 0;

  for (const child of Array.from(tbody.children)) {
    if (!(child instanceof HTMLTableRowElement)) {
      continue;
    }
    if (isTableRowBreakElement(child)) {
      innerShift += child.offsetHeight;
      continue;
    }

    const info = rowInfo[contentRowIndex];
    contentRowIndex++;
    if (info === undefined) {
      continue;
    }

    const rect = child.getBoundingClientRect();
    const measuredTop = (rect.top - editorScreenTop) * invScale;
    const measuredBottom = (rect.bottom - editorScreenTop) * invScale;
    const totalExistingShift = blockShift + innerShift;
    const rowInternalBreakShift = measureRowInternalBreakShift(child, invScale);
    const naturalTop = measuredTop - totalExistingShift;
    const naturalBottom =
      measuredBottom - totalExistingShift - rowInternalBreakShift;

    rows.push({
      naturalTop,
      naturalBottom,
      getPos: () => info.pos,
      isHeaderRow: info.isHeaderRow,
      measureSplitLines: () =>
        measureTableRowSplitLines(
          info.node,
          info.pos,
          view,
          editorScreenTop,
          invScale,
          totalExistingShift,
        ),
    });
  }

  return rows;
}
